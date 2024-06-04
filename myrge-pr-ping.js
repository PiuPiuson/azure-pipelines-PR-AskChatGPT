// ==UserScript==
// @name         PR Ping
// @namespace    http://piu.piuson.com
// @version      1.3.0
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
const PICKUP_STATS_KEY = "pickup-stats";

const ENABLE = "Enable";
const DISABLE = "Disable";

const AUTO_PICK_UP = "Auto PickUp";

let autoPickUpMenuCommand;

let PickupStats = GM_getValue(PICKUP_STATS_KEY, {});
let PlatformIdSet = new Set();

const Today = new Date().toISOString().split("T")[0];

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

function getPrLinkButton(prLine) {
  return prLine?.querySelector('[col-id="Title"]')?.querySelector("button");
}

function getPrURL(prLine) {
  return (
    prLine?.querySelector('[col-id="Title"]')?.children[0]?.children[0]
      ?.children[0]?.href || ""
  );
}

function getPlatformId(prLine) {
  return (
    prLine
      .querySelector("[data-test-id=flex-container]")
      ?.innerText?.replace(/\D/g, "") || ""
  );
}

function isPrAdo(prURL) {
  return prURL.startsWith("https://dev.azure.com");
}

function openPrTab(prLine, delay) {
  const url = getPrURL(prLine);
  setTimeout(() => window.open(url, "_blank"), delay);
}

function pickUpPr(prLine) {
  const button = getStartButton(prLine);
  button?.click();
}

function isTimeToPickUpPr() {
  const lastPrTime = GM_getValue(LAST_PR_TIME_KEY);
  const timeDiff = Date.now() - lastPrTime;

  return timeDiff > GM_getValue(PR_INTERVAL_KEY) * 1000;
}

function createStatsIfNotExist() {
  if (document.querySelector(".pr-stats")) {
    return;
  }

  const pElement = document.createElement("p");
  pElement.className = "text-sm pr-stats";
  pElement.style.fontSize = "12px";
  pElement.style.marginTop = "-7px";
  pElement.style.color = "grey";

  const titleDiv = document.querySelector('[data-test-id="page-header-title"]');
  titleDiv.appendChild(pElement);
}

function displayPrStats() {
  createStatsIfNotExist();

  const prs = PickupStats[Today].PRs;
  const started = PickupStats[Today].Started;

  let scaleFactor = prs / started;
  let scaledDenominator = scaleFactor.toFixed(1);

  const lastPrTime = GM_getValue(LAST_PR_TIME_KEY);
  const timeDiff = ((Date.now() - lastPrTime) / 1000).toFixed(0);

  let nextPrTime = GM_getValue(PR_INTERVAL_KEY) - timeDiff;
  if (nextPrTime < 0) {
    nextPrTime = 0;
  }

  const stats = document.querySelector(".pr-stats");
  stats.innerText = `${started}/${prs} | 1 in ${scaledDenominator} | next: ${Math.floor(
    nextPrTime / 60
  )}:${(nextPrTime % 60).toString().padStart(2, "0")}`;
}

function shouldUpdatePrStats() {
  const url = window.location.href;
  const encoded = url.split("#")[1];
  const options = atob(encoded);

  return options === "(default:(status:Active))";
}

function isModalDisplayed() {
  const modal = document.querySelector(".base-modal-backdrop");
  return modal !== null;
}

function closeModal() {
  const modal = document.querySelector(".base-modal");
  const noButton = modal?.querySelector("[data-test-id=cancel-modal-button]");
  noButton?.click();
}

function updatePrStats(platformIds) {
  if (PlatformIdSet.size === 0) {
    PlatformIdSet = new Set(platformIds);
  }

  const difference = platformIds.filter((id) => !PlatformIdSet.has(id));
  difference.forEach((item) => PlatformIdSet.add(item));

  if (difference.length === 0) {
    return;
  }

  console.log("New PRs:", ...difference);

  PickupStats[Today].PRs += difference.length;
  GM_setValue(PICKUP_STATS_KEY, PickupStats);
}

function doPrMutationLogic(mutations) {
  const prMutations = mutations.filter((mutation) => isPrLine(mutation));
  const prLines = prMutations.map((mutation) => mutation.addedNodes[0]);

  const platformIds = prLines
    .map((line) => getPlatformId(line))
    .filter((id) => id !== "");

  if (platformIds.length === 0) {
    return;
  }

  if (shouldUpdatePrStats()) {
    updatePrStats(platformIds);
  }

  const notStartedLines = prLines.filter(
    (line) => getPrStatus(line) === "Not started"
  );

  if (notStartedLines.length === 0) {
    return;
  }

  if (!GM_getValue(AUTO_PICK_UP_KEY)) {
    debouncedFetchAndPlayAudio();
    return;
  }

  if (isTimeToPickUpPr()) {
    console.log(`Picking up PR`);
    const prLine = notStartedLines[0];

    pickUpPr(prLine);

    setTimeout(() => {
      if (isModalDisplayed()) {
        console.log("PR has already been picked up by someone else");
        closeModal();
      } else {
        GM_setValue(LAST_PR_TIME_KEY, Date.now());

        debouncedFetchAndPlayAudio();
        openPrTab(prLine, 1000);

        PickupStats[Today].Started += 1;
        GM_setValue(PICKUP_STATS_KEY, PickupStats);
      }
    }, 4000);
  }
}

function startPageObserver() {
  const observerConfig = { childList: true, subtree: true };
  const observerTarget = document.body;

  // Create a MutationObserver to monitor changes to the page
  const observer = new MutationObserver((mutations) => {
    doPrMutationLogic(mutations);
  });

  observer.observe(observerTarget, observerConfig);
}

function onPageLoad() {
  console.log("Myrge PR Helper Running");
  startPageObserver();

  if (!PickupStats[Today]) {
    PickupStats[Today] = {
      PRs: 0,
      Started: 0,
    };
  }

  setInterval(displayPrStats, 1000);
}

function setInitialGM() {
  GM_setValue(
    PR_INTERVAL_KEY,
    GM_getValue(PR_INTERVAL_KEY, DEFAULT_PR_INTERVAL)
  );
  GM_setValue(DING_URL_KEY, GM_getValue(DING_URL_KEY, DEFAULT_DING_URL));
  GM_setValue(LAST_PR_TIME_KEY, GM_getValue(LAST_PR_TIME_KEY, Date.now()));
  GM_setValue(AUTO_PICK_UP_KEY, GM_getValue(AUTO_PICK_UP_KEY, true));
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
  GM_unregisterMenuCommand(autoPickUpMenuCommand);

  const pickupEnableDisable = GM_getValue(AUTO_PICK_UP_KEY) ? DISABLE : ENABLE;
  autoPickUpMenuCommand = GM_registerMenuCommand(
    `${pickupEnableDisable} ${AUTO_PICK_UP}`,
    () => {
      GM_setValue(AUTO_PICK_UP_KEY, !GM_getValue(AUTO_PICK_UP_KEY));
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

  console.log(PickupStats);
})();
