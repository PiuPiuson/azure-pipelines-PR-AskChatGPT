// ==UserScript==
// @name         PR Ping
// @namespace    http://piu.piuson.com
// @version      1.1.2
// @description  Automate many PR functions
// @author       Piu Piuson
// @match        https://myrge.co.uk/reviews
// @icon         https://www.google.com/s2/favicons?sz=64&domain=myrge.co.uk
// @downloadURL  https://raw.githubusercontent.com/PiuPiuson/azure-pipelines-PR-AskChatGPT/main/myrge-pr-ping.js
// @updateURL    https://raw.githubusercontent.com/PiuPiuson/azure-pipelines-PR-AskChatGPT/main/myrge-pr-ping.js
// @grant        GM_xmlhttpRequest
// @grant        GM_getResourceURL
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// ==/UserScript==

const DEFAULT_PR_INTERVAL = 3 * 60;
const DEFAULT_DING_URL =
  "http://novastar-main.co.hays.tx.us/NovaStar5/sounds/alarm.wav";

const LAST_PR_TIME_KEY = "last-pr-time";
const DING_URL_KEY = "ding-url";
const PR_INTERVAL_KEY = "pr-interval";
const AUTO_PICK_UP_KEY = "auto-pick-up";
const AUTO_APPROVE_KEY = "auto-approve";

const ENABLE = "Enable";
const DISABLE = "Disable";

const AUTO_APPROVE = "Auto Approve";
const AUTO_PICK_UP = "Auto PickUp";

let autoApproveMenuCommand;
let autoPickUpMenuCommand;


function debounce(func, wait, immediate) {
  let timeout;
  return function () {
    const context = this,
      args = arguments;
    const later = function () {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}

const debouncedFetchAndPlayAudio = debounce(
  () => fetchAndPlayAudio(GM_getValue(DING_URL_KEY)),
  2000,
  true
);

function fetchAndPlayAudio(url) {
  GM_xmlhttpRequest({
    method: "GET",
    url: url,
    responseType: "blob",
    onload: function (response) {
      if (response.status >= 200 && response.status < 300) {
        const audioURL = URL.createObjectURL(response.response);
        const audio = new Audio(audioURL);
        audio.play();
      } else {
        console.error("Failed to load audio:", response.status);
      }
    },
    onerror: function (error) {
      console.error("Error fetching the audio file:", error);
    },
  });
}

function isPrLine(mutation) {
  if (mutation.type === "childList") {
    if (mutation.addedNodes.length === 1) {
      if (mutation.addedNodes[0].classList?.contains("ag-row")) {
        return true;
      }
    }
  }

  return false;
}

function getPrStatus(prLine) {
  return (
    prLine.querySelector('[col-id="pullRequestReviewStatus"]')?.innerText || ""
  );
}

function getStartButton(prLine) {
  return prLine.querySelector('[data-icon="play"]').parentElement;
}

function getPrURL(prLine) {
  return (
    prLine?.querySelector('[col-id="Title"]')?.children[0]?.children[0]
      ?.children[0]?.href || ""
  );
}

function isPrAdo(prURL) {
  return prURL.startsWith("https://dev.azure.com");
}

function pickUpPr(prLine) {
  const button = getStartButton(prLine);
  button?.click();
  GM_setValue(LAST_PR_TIME_KEY, Date.now());

  const url = getPrURL(prLine);
  window.open(url, "_blank");
}

function isTimeToPickUpPr() {
  const lastPrTime = GM_getValue(LAST_PR_TIME_KEY);
  const timeDiff = Date.now() - lastPrTime;

  return timeDiff > GM_getValue(PR_INTERVAL_KEY) * 1000;
}

function startPageObserver() {
  const observerConfig = { childList: true, subtree: true };
  const observerTarget = document.body;

  // Create a MutationObserver to monitor changes to the page
  const observer = new MutationObserver((mutations) => {
    const prMutations = mutations.filter((mutation) => isPrLine(mutation));
    const prLines = prMutations.map((mutation) => mutation.addedNodes[0]);

    const notStartedLines = prLines.filter(
      (line) => getPrStatus(line) === "Not started"
    );

    if (notStartedLines.length === 0) {
      return;
    }

    if (isTimeToPickUpPr()) {
      console.log(`Picking up PR`);
      const pr = notStartedLines[0];

      if (GM_getValue(AUTO_PICK_UP_KEY)) {
        pickUpPr(pr);
        test(pr);
      }

      debouncedFetchAndPlayAudio();
    } else {
      console.log(`NOT picking up PR`);
    }
  });

  observer.observe(observerTarget, observerConfig);
}

function onPageLoad() {
  console.log("Pr Ping Running");
  startPageObserver();
}

function setInitialGM() {
  GM_setValue(
    PR_INTERVAL_KEY,
    GM_getValue(PR_INTERVAL_KEY, DEFAULT_PR_INTERVAL)
  );
  GM_setValue(DING_URL_KEY, GM_getValue(DING_URL_KEY, DEFAULT_DING_URL));
  GM_setValue(LAST_PR_TIME_KEY, GM_getValue(LAST_PR_TIME_KEY, Date.now()));
  GM_setValue(AUTO_PICK_UP_KEY, GM_getValue(AUTO_PICK_UP_KEY, true));
  GM_setValue(AUTO_APPROVE_KEY, GM_getValue(AUTO_PICK_UP_KEY, true));
}

function registerStaticMenuCommands() {
  GM_registerMenuCommand("Set Ding Sound", () => {
    let dingUrl = window.prompt(
      "Enter the URL of the ding sound (leave empty for default):",
      GM_getValue(DING_URL_KEY, DEFAULT_DING_URL)
    );

    if (!dingUrl) {
      return;
    }

    if (dingUrl.trim() === "") {
      dingUrl = DEFAULT_DING_URL;
    }
    GM_setValue(DING_URL_KEY, dingUrl);
  });

  GM_registerMenuCommand("Set Pickup Interval", () => {
    let interval = window.prompt(
      "Enter how often a PR should be picked up (in seconds):",
      GM_getValue(PR_INTERVAL_KEY, DEFAULT_PR_INTERVAL)
    );

    if (!interval) {
      return;
    }

    GM_setValue(PR_INTERVAL_KEY, interval);
  });
}

function updateDynamicMenuCommends() {
  GM_unregisterMenuCommand(autoApproveMenuCommand);
  GM_unregisterMenuCommand(autoPickUpMenuCommand);

  const pickupEnableDisable = GM_getValue(AUTO_PICK_UP_KEY) ? DISABLE : ENABLE;
  const approveEnableDisable = GM_getValue(AUTO_APPROVE_KEY) ? DISABLE : ENABLE;

  autoApproveMenuCommand = GM_registerMenuCommand(
    `${pickupEnableDisable} ${AUTO_PICK_UP}`,
    () => {
      GM_setValue(AUTO_PICK_UP_KEY, !GM_getValue(AUTO_PICK_UP_KEY));
      updateDynamicMenuCommends();
    }
  );
  autoPickUpMenuCommand = GM_registerMenuCommand(
    `${approveEnableDisable} ${AUTO_APPROVE}`,
    () => {
      GM_setValue(AUTO_APPROVE_KEY, !GM_getValue(AUTO_APPROVE_KEY));
      updateDynamicMenuCommends();
    }
  );
}

(function () {
  "use strict";

  setInitialGM();

  registerStaticMenuCommands();
  updateDynamicMenuCommends();

  onPageLoad();
})();
