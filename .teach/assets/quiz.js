/* Self-checking retrieval quiz. Reusable across lessons.
 *
 * Markup contract:
 *   <div class="quiz">
 *     <p class="q">Question?</p>
 *     <div class="opts">
 *       <button>wrong answer</button>
 *       <button data-correct>right answer</button>
 *     </div>
 *     <div class="why"><b>…</b> explanation</div>
 *   </div>
 *
 * Feedback is immediate and the explanation shows either way — a wrong answer
 * you understand is worth more than a right one you guessed.
 */
(function () {
  var asked = 0, right = 0;
  document.querySelectorAll('.quiz').forEach(function (quiz) {
    var why = quiz.querySelector('.why');
    quiz.querySelectorAll('.opts button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (quiz.dataset.done) return;
        quiz.dataset.done = '1';
        asked++;
        var ok = btn.hasAttribute('data-correct');
        if (ok) right++;
        quiz.querySelectorAll('.opts button').forEach(function (b) {
          b.disabled = true;
          if (b.hasAttribute('data-correct')) b.classList.add('right');
        });
        if (!ok) btn.classList.add('wrong');
        if (why) why.classList.add('show');
        var score = document.getElementById('score');
        if (score) {
          score.textContent =
            right + ' of ' + asked + ' recalled' +
            (asked === document.querySelectorAll('.quiz').length
              ? ' — come back in two days and try again from memory.'
              : '');
        }
      });
    });
  });
})();
