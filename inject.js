// runs in the page context (not the extension sandbox)
// patches fetch so we can detect when a LeetCode submission is accepted

(function () {
  const _fetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _fetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/check')) {
        res.clone().json().then((data) => {
          if (data.state === 'SUCCESS' && data.status_msg) {
            document.dispatchEvent(
              new CustomEvent('__lct_submission', {
                detail: { status: data.status_msg },
              })
            );
          }
        }).catch(() => {});
      }
    } catch {}
    return res;
  };
})();
