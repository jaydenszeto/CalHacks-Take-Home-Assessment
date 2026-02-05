// runs in the page context (not the extension sandbox)
// patches fetch to detect REAL submissions only (not "Run Code")
//
// LeetCode flow:
//   Run Code  → POST /interpret_solution/ → polls /check → result
//   Submit    → POST /submit/             → polls /check → result
//
// We track the submission_id from /submit/ and only fire
// the event when the matching /check comes back accepted.

(function () {
  const _fetch = window.fetch;
  let submitId = null;

  window.fetch = async function (...args) {
    const res = await _fetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      // catch the actual submit POST (not interpret_solution)
      if (url.includes('/submit') && !url.includes('/check')) {
        res.clone().json().then((data) => {
          if (data.submission_id) submitId = String(data.submission_id);
        }).catch(() => {});
      }

      // only report if this check belongs to a real submission
      if (submitId && url.includes('/check') && url.includes(submitId)) {
        res.clone().json().then((data) => {
          if (data.state === 'SUCCESS') {
            document.dispatchEvent(
              new CustomEvent('__lct_submission', {
                detail: { status: data.status_msg },
              })
            );
            submitId = null;
          }
        }).catch(() => {});
      }
    } catch {}
    return res;
  };
})();
