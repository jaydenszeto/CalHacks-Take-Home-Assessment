// LeetCode Together — background service worker
// Will handle websocket connection to the room server later

chrome.runtime.onInstalled.addListener(() => {
  console.log("LeetCode Together installed");
});
