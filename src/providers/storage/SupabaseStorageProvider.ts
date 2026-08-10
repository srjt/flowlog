// SDK 54: the classic readAsStringAsync/EncodingType API now lives under /legacy.
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';
import type { IStorageProvider } from '@/providers/storage/IStorageProvider';
import type {
  NewSession,
  Session,
  SessionAnalysisUpdate,
  UserTrends,
} from '@/types/session';
import type { SportKey } from '@/types/sport';
import { base64ToUint8Array } from '@/utils/audioTranscode';
import { logger } from '@/utils/logger';

const AUDIO_BUCKET = 'session-audio';

const EXT_BY_TYPE: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
};

/**
 * Supabase implementation of IStorageProvider: audio in Storage, rows in
 * Postgres (RLS-protected so each user sees only their own data). All
 * snake_case <-> camelCase mapping lives here so the rest of the app speaks
 * camelCase domain types.
 */
export class SupabaseStorageProvider implements IStorageProvider {
  async isAvailable(): Promise<boolean> {
    try {
      const { error } = await supabase.auth.getSession();
      return !error;
    } catch {
      return false;
    }
  }

  async uploadAudio(userId: string, audioUri: string): Promise<string> {
    // Web: browser Blobs carry real bytes — upload directly.
    //
    // Native: DO NOT upload a fetch(file://).blob() here. React Native's Blob
    // is a reference to native memory, and handing it to supabase-js results
    // in an EMPTY request body — the upload "succeeds" with the right path
    // and content type but stores a 0-byte object. Every native recording
    // uploaded through the old blob path was empty, which downstream made
    // Gemini fabricate transcripts out of thin air (there was no audio to
    // transcribe) and Whisper fail with an undecodable-file error. Reading
    // the file into real bytes and uploading the ArrayBuffer is the
    // supabase-recommended React Native path.
    if (Platform.OS === 'web') {
      const blob = await (await fetch(audioUri)).blob();
      const contentType = blob.type || 'audio/m4a';
      const ext = EXT_BY_TYPE[contentType] ?? 'm4a';
      return this.uploadBytes(userId, blob, contentType, ext);
    }

    const base64 = await FileSystem.readAsStringAsync(audioUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToUint8Array(base64);
    const uriExt = audioUri.split('.').pop()?.toLowerCase() ?? 'm4a';
    const ext = Object.values(EXT_BY_TYPE).includes(uriExt) ? uriExt : 'm4a';
    const contentType =
      Object.entries(EXT_BY_TYPE).find(([, e]) => e === ext)?.[0] ??
      'audio/m4a';
    return this.uploadBytes(
      userId,
      bytes.buffer as ArrayBuffer,
      contentType,
      ext,
    );
  }

  private async uploadBytes(
    userId: string,
    body: Blob | ArrayBuffer,
    contentType: string,
    ext: string,
  ): Promise<string> {
    const size = body instanceof ArrayBuffer ? body.byteLength : body.size;
    if (size === 0) {
      // Fail loudly instead of shipping an empty file into the pipeline.
      throw new Error('Audio upload failed: the recording file is empty.');
    }
    const path = `${userId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(path, body, { contentType, upsert: false });

    if (error) {
      logger.error('SupabaseStorageProvider.uploadAudio failed', error);
      throw new Error(`Audio upload failed: ${error.message}`);
    }
    return path;
  }

  async saveSession(session: NewSession): Promise<Session> {
    const { data, error } = await supabase
      .from('sessions')
      .insert({
        user_id: session.userId,
        sport_key: session.sportKey,
        session_date: session.sessionDate,
        audio_storage_path: session.audioStoragePath,
        raw_transcript: session.rawTranscript,
        positions_visited: session.positionsVisited,
        key_mistake: session.keyMistake,
        opponent_action: session.opponentAction,
        sentiment: session.sentiment,
        coaching_cue: session.coachingCue,
        target_position: session.targetPosition,
        quality_gate_passed: session.qualityGatePassed,
        pipeline_version: session.pipelineVersion,
      })
      .select()
      .single();

    if (error || !data) {
      logger.error('SupabaseStorageProvider.saveSession failed', error);
      throw new Error(`Save session failed: ${error?.message ?? 'no row'}`);
    }
    return mapSession(data);
  }

  async updateSessionAnalysis(
    sessionId: string,
    update: SessionAnalysisUpdate,
  ): Promise<Session> {
    // RLS ("Users own their sessions", FOR ALL) restricts this to the owner.
    const { data, error } = await supabase
      .from('sessions')
      .update({
        raw_transcript: update.rawTranscript,
        positions_visited: update.positionsVisited,
        key_mistake: update.keyMistake,
        opponent_action: update.opponentAction,
        sentiment: update.sentiment,
        coaching_cue: update.coachingCue,
        target_position: update.targetPosition,
        quality_gate_passed: update.qualityGatePassed,
        pipeline_version: update.pipelineVersion,
      })
      .eq('id', sessionId)
      .select()
      .single();

    if (error || !data) {
      logger.error(
        'SupabaseStorageProvider.updateSessionAnalysis failed',
        error,
      );
      throw new Error(`Update session failed: ${error?.message ?? 'no row'}`);
    }
    return mapSession(data);
  }

  async listSessions(userId: string, limit = 50): Promise<Session[]> {
    const { data, error } = await supabase
      .from('sessions')
      .select()
      .eq('user_id', userId)
      .order('session_date', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`List sessions failed: ${error.message}`);
    return (data ?? []).map(mapSession);
  }

  async getRecentMistakes(userId: string, limit: number): Promise<string[]> {
    const { data, error } = await supabase
      .from('sessions')
      .select('key_mistake')
      .eq('user_id', userId)
      .not('key_mistake', 'is', null)
      .order('session_date', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`Recent mistakes failed: ${error.message}`);
    return (data ?? [])
      .map((row) => (row as { key_mistake: string | null }).key_mistake)
      .filter((m): m is string => Boolean(m));
  }

  async getUserTrends(
    userId: string,
    sportKey: string,
  ): Promise<UserTrends | null> {
    const { data, error } = await supabase
      .from('user_trends')
      .select()
      .eq('user_id', userId)
      .eq('sport_key', sportKey)
      .maybeSingle();

    if (error) throw new Error(`Get trends failed: ${error.message}`);
    if (!data) return null;
    return mapTrends(data);
  }

  async setSessionFeedback(
    sessionId: string,
    thumbsUp: boolean,
    reason?: string | null,
    note?: string | null,
  ): Promise<void> {
    const { error } = await supabase
      .from('sessions')
      .update({
        thumbs_up: thumbsUp,
        feedback_reason: reason ?? null,
        feedback_note: note ?? null,
      })
      .eq('id', sessionId);
    if (error) throw new Error(`Set feedback failed: ${error.message}`);
  }

  async deleteSession(sessionId: string): Promise<void> {
    // Grab the audio path BEFORE the row disappears.
    const { data } = await supabase
      .from('sessions')
      .select('audio_storage_path')
      .eq('id', sessionId)
      .maybeSingle();

    // RLS ("Users own their sessions", FOR ALL) restricts this to the owner.
    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('id', sessionId);
    if (error) throw new Error(`Delete session failed: ${error.message}`);

    // Best-effort audio removal (needs the "own audio delete" storage
    // policy). Row deletion stays authoritative: an orphaned object on a
    // storage blip is acceptable; a deleted recording with a live row is not.
    const path = (data as { audio_storage_path: string | null } | null)
      ?.audio_storage_path;
    if (path) {
      const { error: storageError } = await supabase.storage
        .from(AUDIO_BUCKET)
        .remove([path]);
      if (storageError) {
        logger.warn('session audio delete failed (row removed)', storageError);
      }
    }
  }
}

// ── Row mappers ───────────────────────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function mapSession(row: any): Session {
  return {
    id: row.id,
    userId: row.user_id,
    sportKey: row.sport_key as SportKey,
    sessionDate: row.session_date,
    audioStoragePath: row.audio_storage_path ?? null,
    rawTranscript: row.raw_transcript ?? null,
    positionsVisited: row.positions_visited ?? [],
    keyMistake: row.key_mistake ?? null,
    opponentAction: row.opponent_action ?? null,
    sentiment: row.sentiment ?? null,
    coachingCue: row.coaching_cue ?? null,
    targetPosition: row.target_position ?? null,
    qualityGatePassed: row.quality_gate_passed ?? false,
    thumbsUp: row.thumbs_up ?? null,
    feedbackReason: row.feedback_reason ?? null,
    feedbackNote: row.feedback_note ?? null,
    pipelineVersion: row.pipeline_version ?? null,
    createdAt: row.created_at,
  };
}

function mapTrends(row: any): UserTrends {
  return {
    userId: row.user_id,
    sportKey: row.sport_key as SportKey,
    dominantWeakness: row.dominant_weakness ?? null,
    positionsStruggled: row.positions_struggled ?? {},
    sessionCount: row.session_count ?? 0,
    streakDays: row.streak_days ?? 0,
    lastSessionAt: row.last_session_at ?? null,
    updatedAt: row.updated_at,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
