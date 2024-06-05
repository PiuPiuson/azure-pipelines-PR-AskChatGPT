// ==UserScript==
// @name         PR Ping
// @namespace    http://piu.piuson.com
// @version      1.4.1
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

// ---------- DEFAULTS -------------
const DEFAULT_PR_INTERVAL = 3 * 60;
const DEFAULT_DING_URL =
  "http://novastar-main.co.hays.tx.us/NovaStar5/sounds/alarm.wav";

// ---------- TM STORAGE KEYS -------------
const KEY_LAST_PR_TIME = "last-pr-time";
const KEY_DING_URL = "ding-url";
const KEY_PICKUP_INTERVAL = "pr-interval";
const KEY_AUTO_PICK_UP = "auto-pick-up";
const KEY_PICKUP_STATS = "pickup-stats";

// ---------- STRINGS -------------
const ENABLE = "Enable";
const DISABLE = "Disable";
const AUTO_PICK_UP = "Auto PickUp";

// ---------- DOM ELEMENT QUERIES -------------
const QUERY_START_BUTTON = '[data-test-id$="-start-button"]';
const QUERY_PR_STATUS = '[col-id="pullRequestReviewStatus"]';
const QUERY_CANCEL_MODAL_BUTTON = "[data-test-id=cancel-modal-button]";
const QUERY_PR_LINE = ".ag-row";

// ---------- CLASSES -------------
class TamperMonkey {
  #autoPickUpMenuCommand;

  constructor() {
    this.setInitialStorageValues();
  }

  /**
   * Registers the static menu commands
   */
  registerStaticMenuCommands() {
    GM_registerMenuCommand("Set Ding Sound", () => {
      let dingUrl = window.prompt(
        "Enter the URL of the ding sound:",
        this.dingUrl || DEFAULT_DING_URL
      );

      if (!dingUrl) {
        return;
      }

      if (dingUrl.trim() === "") {
        dingUrl = DEFAULT_DING_URL;
      }
      this.dingUrl = dingUrl;
    });

    GM_registerMenuCommand("Set Pickup Interval", () => {
      let interval = window.prompt(
        "Enter how often a PR should be picked up (in seconds):",
        this.pickupInterval
      );

      if (!interval) {
        return;
      }

      this.pickupInterval = interval;
    });
  }

  /**
   * Registers and/or updates the dynamic menu commands
   */
  updateDynamicMenuCommends() {
    GM_unregisterMenuCommand(this.#autoPickUpMenuCommand);

    const pickupEnableDisable = this.autoPickupEnabled ? DISABLE : ENABLE;

    this.#autoPickUpMenuCommand = GM_registerMenuCommand(
      `${pickupEnableDisable} ${AUTO_PICK_UP}`,
      () => {
        this.autoPickupEnabled = !this.autoPickupEnabled;
        this.updateDynamicMenuCommends();
      }
    );
  }

  /**
   * Initializes the storage values to their defaults if they don't exist
   */
  setInitialStorageValues() {
    GM_setValue(
      KEY_PICKUP_INTERVAL,
      GM_getValue(KEY_PICKUP_INTERVAL, DEFAULT_PR_INTERVAL)
    );
    GM_setValue(KEY_DING_URL, GM_getValue(KEY_DING_URL, DEFAULT_DING_URL));
    GM_setValue(KEY_LAST_PR_TIME, GM_getValue(KEY_LAST_PR_TIME, Date.now()));
    GM_setValue(KEY_AUTO_PICK_UP, GM_getValue(KEY_AUTO_PICK_UP, true));
  }

  get lastPrTime() {
    return GM_getValue(KEY_LAST_PR_TIME);
  }
  set lastPrTime(time) {
    GM_setValue(KEY_LAST_PR_TIME, time);
  }

  get dingUrl() {
    return GM_getValue(KEY_DING_URL);
  }
  set dingUrl(url) {
    GM_setValue(KEY_DING_URL, url);
  }

  get pickupInterval() {
    return GM_getValue(KEY_PICKUP_INTERVAL);
  }
  set pickupInterval(interval) {
    GM_setValue(KEY_PICKUP_INTERVAL, interval);
  }

  get autoPickupEnabled() {
    return GM_getValue(KEY_AUTO_PICK_UP);
  }
  set autoPickupEnabled(enabled) {
    GM_setValue(KEY_AUTO_PICK_UP, enabled);
  }

  get pickupStats() {
    return GM_getValue(KEY_PICKUP_STATS);
  }
  set pickupStats(stats) {
    GM_setValue(KEY_PICKUP_STATS, stats);
  }
}
const TM = new TamperMonkey();

class PrStats {
  #platformIdSet = new Set();
  #scaledDenominator = 0;

  /**
   * Today's date as formatted string
   */
  #today = new Date().toISOString().split("T")[0];

  constructor() {
    if (!TM.pickupStats[this.#today]) {
      const stats = TM.pickupStats;
      stats[this.#today] = {
        PRs: 0,
        Started: 0,
      };

      TM.pickupStats = stats;
    }
  }

  /**
   * Creates the Stats element in the page if it doesn't exist
   */
  #createPageElementsIfNotExist = () => {
    if (document.querySelector(".pr-stats")) {
      return;
    }

    const pElement = document.createElement("p");
    pElement.className = "text-sm pr-stats";
    pElement.style.fontSize = "12px";
    pElement.style.marginTop = "-7px";
    pElement.style.color = "grey";

    const titleDiv = document.querySelector(
      '[data-test-id="page-header-title"]'
    );
    titleDiv.appendChild(pElement);
  };

  /**
   * Checks whether or not the PR stats should be updated
   * If we're not in the correct sorting order for example a lot of erroneous PRs will come in and skew statistics
   */
  shouldUpdate = () => {
    const url = window.location.href;
    const encoded = url.split("#")[1];
    const options = atob(encoded);

    return options === "(default:(status:Active))";
  };

  /**
   * Displays the PR statistics on page
   */
  display = () => {
    this.#createPageElementsIfNotExist();

    const prs = TM.pickupStats[this.#today].PRs;
    const started = TM.pickupStats[this.#today].Started;

    let scaleFactor = prs / started;
    this.#scaledDenominator = scaleFactor.toFixed(1);

    const timeDiff = ((Date.now() - TM.lastPrTime) / 1000).toFixed(0);

    let nextPrTime = TM.pickupInterval - timeDiff;
    if (nextPrTime < 0) {
      nextPrTime = 0;
    }

    const stats = document.querySelector(".pr-stats");
    stats.innerText = `${started}/${prs} | 1 in ${
      this.#scaledDenominator
    } | next: ${Math.floor(nextPrTime / 60)}:${(nextPrTime % 60)
      .toString()
      .padStart(2, "0")}`;
  };

  /**
   * Updates the statistics from PRs in the current view
   * @param {string[]} platformIds Platform IDs of PRs in current view
   */
  update = (platformIds) => {
    if (this.#platformIdSet.size === 0) {
      this.#platformIdSet = new Set(platformIds);
    }

    const difference = platformIds.filter((id) => !this.#platformIdSet.has(id));
    difference.forEach((item) => this.#platformIdSet.add(item));

    if (difference.length === 0) {
      return;
    }

    TM.pickupStats[this.#today].PRs += difference.length;
  };

  /**
   * Call when picking up a PR to update stats accordingly
   */
  pickedUpPr = () => {
    TM.pickupStats[this.#today].Started += 1;
  };

  /**
   * Gets the scaled denominator for picked up PRs (1 in every X)
   */
  getScaledDenominator = () => this.#scaledDenominator;
}
const Stats = new PrStats();

// ---------- FUNCTIONS -------------
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
  () => fetchAndPlayAudio(TM.dingUrl),
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

/**
 * Gets the status of a PR given the PR line
 * @param {string} prLine
 */
function getPrStatus(prLine) {
  return prLine.querySelector(QUERY_PR_STATUS)?.innerText || "";
}

/**
 * Gets the start button from a PR line
 * @param {string} prLine
 */
function getStartButton(prLine) {
  return prLine?.querySelector(QUERY_START_BUTTON);
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

/**
 * Opens the PR from a PR line in a new browser tab
 * @param {string} prLine
 */
function openPrTab(prLine, delay) {
  const url = getPrURL(prLine);
  window.open(url, "_blank");
}

/**
 * Starts the PR in the given PRline.
 * It also disables the event listener on its start button.
 * @param {string} prLine
 */
function pickUpPr(prLine) {
  const button = getStartButton(prLine);
  button?.removeEventListener("click", onStartButtonClick);
  button?.click();
}

/**
 * Checks whether a PR should be picked up
 */
function shouldPickupPr() {
  const timeDiff = Date.now() - TM.lastPrTime;

  return timeDiff > TM.pickupInterval * 1000;
}

/**
 * Checks whether a modal is being displayed
 */
function isModalDisplayed() {
  const modal = document.querySelector(".base-modal-backdrop");
  return modal !== null;
}

/**
 * Closes the PR has already been picked up modal
 */
function closeModal() {
  const modal = document.querySelector(".base-modal");
  const noButton = modal?.querySelector(QUERY_CANCEL_MODAL_BUTTON);
  noButton?.click();
}

/**
 * Handler for start button click
 * It checks every 200ms if the modal is present. If after 4s it is not,
 * the PR is registered as picked up
 */
function onStartButtonClick() {
  const startTime = Date.now();

  const intervalId = setInterval(() => {
    const currentTime = Date.now();
    const elapsedTime = currentTime - startTime;

    if (isModalDisplayed()) {
      clearInterval(intervalId);
      return;
    }

    if (elapsedTime >= 4000) {
      clearInterval(intervalId);

      TM.lastPrTime = currentTime;
      Stats.pickedUpPr();
    }
  }, 200);
}

function doPrMutationLogic(mutations) {
  const prLines = mutations
    .filter((mutation) => isPrLine(mutation))
    .map((mutation) => mutation.addedNodes[0]);

  const platformIds = prLines
    .map((line) => getPlatformId(line))
    .filter((id) => id && id !== "");

  if (platformIds.length === 0) {
    return;
  }

  if (Stats.shouldUpdate()) {
    Stats.update(platformIds);
  }

  const notStartedLines = prLines.filter(
    (line) => getPrStatus(line) === "Not started"
  );

  if (notStartedLines.length === 0) {
    return;
  }

  if (!TM.autoPickupEnabled) {
    debouncedFetchAndPlayAudio();
    return;
  }

  if (shouldPickupPr()) {
    console.log(`Picking up PR`);
    const prLine = notStartedLines[0];

    pickUpPr(prLine);

    setTimeout(() => {
      if (isModalDisplayed()) {
        closeModal();

        console.log("PR has already been picked up by someone else");
        return;
      }

      debouncedFetchAndPlayAudio();
      setTimeout(() => openPrTab(prLine), 1000);

      TM.lastPrTime = Date.now();
      Stats.pickedUpPr();
    }, 4000);
  }
}

/**
 * Attaches the onStartButtonClick event listener to all buttons in the page
 */
function attachEventListenerToStartButtons() {
  const buttons = document.querySelectorAll(QUERY_START_BUTTON);
  buttons.forEach((button) => {
    button.addEventListener("click", onStartButtonClick);
  });
}

function startPageObserver() {
  const observerConfig = { childList: true, subtree: true };
  const observerTarget = document.body;

  // Create a MutationObserver to monitor changes to the page
  const observer = new MutationObserver((mutations) => {
    // We attach the event listener to all start buttons on every mutation.
    // This stops the event listener going away after one button is clicked.
    attachEventListenerToStartButtons();

    doPrMutationLogic(mutations);
  });

  observer.observe(observerTarget, observerConfig);
}

// ---------- SCRIPT ENTRY POINT -------------
(function () {
  "use strict";

  TM.registerStaticMenuCommands();
  TM.updateDynamicMenuCommends();

  startPageObserver();

  // Update the PR stats every second
  setInterval(Stats.display, 1000);

  console.log("Myrge PR Helper Running");
})();
