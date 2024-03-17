// ==UserScript==
// @name Cohost Dedup
// @namespace https://morine.net
// @version 1.4.1
// @description Deduplicate posts and mark posts you've already seen on Cohost, plus add tenpo ko timestamps
// @author Natalie Weizenbaum
// @author Mori
// @author @two
// @match https://cohost.org/*
// @match https://*.cohost.org/*
// @updateURL https://github.com/remorae/cohost-dedup/raw/main/cohost-dedup.user.js
// @downloadURL https://github.com/remorae/cohost-dedup/raw/main/cohost-dedup.user.js
// @exclude https://cohost.org/*/post/*
// @exclude https://cohost.org/rc/search
// @exclude https://cohost.org/rc/project/*
// @exclude https://cohost.org/rc/user/*
// @exclude https://cohost.org/rc/posts/unpublished*
// ==/UserScript==

// Changelog
//   v1.4.1 (Mori)
//     Additions:
//       .-cohost-dedup-read-chost-indicator {...}
//       markChostRead(chost) {...}
//       addTenpoKo(chost) {...} - see https://cohost.org/two/post/751520-introducing-tenpo-k
//       LocalStoreSet
//       storageAvailable
//     Changes:
//       checkThread:
//         Add a checkmark to the upper-left corner of chosts if they aren't hidden but they've been seen before in the current session
//       observer:
//         Prevent errors due to undefined node.dataset/node.querySelectorAll
//   v1.4
//     See https://github.com/nex3/cohost-dedup/commit/aeef8fe5d7e315e56e606e16c59e0ca2a250a2ef

// To turn off the script on the pages you own (it messes with things you've shared), edit/add these lines within the ==UserScript== section above
// (or add them to your user excludes in Tampermonkey):
// @exclude https://cohost.org/your_page_here
// @exclude https://cohost.org/your_other_page_here

// Should be compatible with Firefox (desktop and mobile) and Chrome. To use,
// install Tampermonkey from https://www.tampermonkey.net/, then visit
// https://github.com/nex3/cohost-dedup/blob/main/cohost-dedup.user.js and click
// "Raw" in the top right.

const hiddenChostsHeight = '150px';

const style = document.createElement("style");
style.innerText = `
  @property --cohost-dedup-opacity {
    syntax: '<number>';
    initial-value: 1;
    inherits: false;
  }

  .-cohost-dedup-hidden-chost, .-cohost-dedup-hidden-thread {
    display: none;
  }

  .-cohost-dedup-hidden-chost.-cohost-dedup-last {
    display: block;
    height: ${hiddenChostsHeight};
    position: relative;
    overflow: hidden;
    margin-bottom: -${hiddenChostsHeight};
  }

  .-cohost-dedup-read-chost-indicator {
    display: block;
    position: relative;
    overflow: hidden;
  }

  .-cohost-dedup-hidden-chost.-cohost-dedup-last > :not(div:not(.flex)) {
    display: none;
  }

  .-cohost-dedup-hidden-chost.-cohost-dedup-last > div:not(.flex) {
    position: absolute;
    bottom: 0;
  }

  :is(.-cohost-dedup-hidden-chost, .-cohost-dedup-link) + .prose,
  :is(.-cohost-dedup-hidden-chost, .-cohost-dedup-link) + .prose + hr {
    display: none;
  }

  .-cohost-dedup-link {
    --cohost-dedup-opacity: 0.5;
    color: rgb(130 127 124 / var(--cohost-dedup-opacity));
    font-size: 2rem;
    display: block;
    text-align: center;
    height: ${hiddenChostsHeight};
    padding-top: calc(${hiddenChostsHeight} - 35px);
    background: linear-gradient(0deg,
        rgb(255 255 255 / calc(1 - var(--cohost-dedup-opacity))), white);
    position: relative;
    transition: --cohost-dedup-opacity 0.5s;
    margin-bottom: 10px;
  }

  .-cohost-dedup-link:hover {
    --cohost-dedup-opacity: 1;
  }
`;
document.head.appendChild(style);

function getChosts(thread) {
  return thread.querySelectorAll(":scope > article > div");
}

function getChostLink(chost) {
  return chost.querySelector(":scope > :nth-child(2) time > a")?.href ??
      chost.parentElement.querySelector(":scope > header time > a").href;
}

function hasTags(chost) {
  return !!chost.querySelector("a.inline-block.text-gray-400");
}

function previousSiblingThroughShowHide(element) {
  const prev = element.previousSibling;
  if (prev.nodeName !== 'HR') return prev;

  const next = prev.previousSibling;
  return next.innerText.match(/^(show|hide) /) ? next.previousSibling : null;
}

function hideChost(chost) {
  chost.classList.add('-cohost-dedup-hidden-chost');
  chost.classList.add('-cohost-dedup-last');
  const prev = previousSiblingThroughShowHide(chost);
  if (prev?.classList?.contains("-cohost-dedup-link")) {
    prev.previousSibling.classList.remove('-cohost-dedup-last');
    prev.href = getChostLink(chost);
    prev.before(chost);
  } else {
    const a = document.createElement("a");
    a.classList.add("-cohost-dedup-link");
    a.href = getChostLink(chost);
    a.innerText = "...";
    chost.after(a);
    a.onclick = event => {
      const prev = a.previousSibling;
      prev.classList.remove("-cohost-dedup-hidden-chost");
      prev.classList.remove("-cohost-dedup-last");

      const next = previousSiblingThroughShowHide(prev);
      if (next?.classList?.contains("-cohost-dedup-hidden-chost")) {
        next.classList.add("-cohost-dedup-last");
        next.after(a);
      } else {
        a.remove();
      }

      return false;
    };
  }

  if (chost.nextSibling.nextSibling.nodeName !== 'DIV') {
    chost.parentElement.parentElement.parentElement.classList.add(
        '-cohost-dedup-hidden-thread');
  }
}

function markChostRead(chost) {
  if (chost.parentNode.querySelector('.-cohost-dedup-read-chost-indicator')) {
      return;
  }
  const span = document.createElement("span");
  span.classList.add('-cohost-dedup-read-chost-indicator');
  span.innerHTML = "✓";
  chost.before(span);
}

class LocalStoreSet {
  constructor(name) {
    this.name = name;
  }

  has(value) {
    return this.set.has(value);
  }

  add(value) {
    this.set.add(value);
    localStorage.setItem(this.name, JSON.stringify([...this.set]));
  }

  load() {
    const stored = localStorage.getItem(this.name);
    this.set = stored === null ? new Set() : new Set(JSON.parse(stored));
    if (stored) {
      const len = ((stored.length || 0) + (this.name.length || 0)) * 2;
      const kb = (len / 1024).toFixed(2);
      console.log("Loaded " + this.name + ": " + kb + " KB");
    }
        '-cohost-dedup-hidden-thread');
  }
}

class SessionStoreSet {
  constructor(name) {
    this.name = name;
    const stored = window.sessionStorage.getItem(name);
    this.set = stored === null ? new Set() : new Set(JSON.parse(stored));
  }

  has(value) {
    return this.set.has(value);
  }

  add(value) {
    this.set.add(value);
    window.sessionStorage.setItem(this.name, JSON.stringify([...this.set]));
  }
}

function storageAvailable(type) {
  let storage;
  try {
    storage = window[type];
    const x = "__storage_test__";
    storage.setItem(x, x);
    storage.removeItem(x);
    return true;
  } catch (e) {
    return (
      e instanceof DOMException &&
      // everything except Firefox
      (e.code === 22 ||
        // Firefox
        e.code === 1014 ||
        // test name field too, because code might not be present
        // everything except Firefox
        e.name === "QuotaExceededError" ||
        // Firefox
        e.name === "NS_ERROR_DOM_QUOTA_REACHED") &&
      // acknowledge QuotaExceededError only if there's something already stored
      storage &&
      storage.length !== 0
    );
  }
}

function getTimestamps(thread) {
  return thread.querySelectorAll(":scope > article > header > div > time");
}

function addTenpoKo(ele) {
  let thetimestamp = new Date(ele.dateTime);
  //this is how you're meant to do it right?
  let thehours = thetimestamp.getUTCHours();
  const span = document.createElement("span");
  span.classList.add('tenpo-ko-emoji');
  if (thehours < 6) {
    span.innerHTML = "🔥";
  } else if (thehours < 12) {
    span.innerHTML = "☁";
  } else if (thehours < 18) {
    span.innerHTML = "💧";
  } else if (thehours < 24) {
    //redundant check but avoids adding 🌱 when something goes wrong
    span.innerHTML = "🌱";
  }
  ele.after(span);
}

const useLocal = storageAvailable("localStorage");
const seenChostIds = (useLocal)
  ? new LocalStoreSet('-cohost-dedup-seen-chost-ids')
  : new SessionStoreSet('-cohost-dedup-seen-chost-ids');
const shownChostFullIds = (useLocal)
  ? new LocalStoreSet('-cohost-dedup-shown-chost-full-ids')
  : new SessionStoreSet('-cohost-dedup-shown-chost-full-ids');
function checkThread(thread) {
  const threadId = thread.dataset.testid;
  if (!threadId) return;
  console.log(`Checking ${threadId}`);

  for (const chost of getChosts(thread)) {
    const id = getChostLink(chost);
    const fullId = `${threadId} // ${id}`;
    if (seenChostIds.has(id) && shownChostFullIds.has(fullId)) {
      markChostRead(chost);
    } else if (seenChostIds.has(id) && !shownChostFullIds.has(fullId)) {
      console.log(`Hiding chost ${id}`);
      hideChost(chost);
    } else {
      seenChostIds.add(id);
      shownChostFullIds.add(fullId);
    }
  }
  for (const timestamp of getTimestamps(thread)) {
    addTenpoKo(timestamp);
  }
}

const observer = new MutationObserver(mutations => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (!node.dataset) {
        continue;
      }
      if (node.dataset.view === 'post-preview') {
        checkThread(node);
      } else {
        if (node.childNodes.length === 0) {
          continue;
        }
        for (const thread of
            node.querySelectorAll('[data-view=post-preview]')) {
          checkThread(thread);
        }
      }
    }
  }
});

function reload(context) {
  if (useLocal) {
    console.log("Reloading (" + context + ")...");
    seenChostIds.load();
    shownChostFullIds.load();
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
      reload("visibilitychange, shown");
  }
});
window.addEventListener("load", () => {
  reload("load");
  observer.observe(document.body, {subtree: true, childList: true});
});
