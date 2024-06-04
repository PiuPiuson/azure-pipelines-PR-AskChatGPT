// ==UserScript==
// @name         PR Ping
// @namespace    http://piu.piuson.com
// @version      1.4.0
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

// ---------- GM KEYS -------------
const LAST_PR_TIME_KEY = "last-pr-time";
const DING_URL_KEY = "ding-url";
const PR_INTERVAL_KEY = "pr-interval";
const AUTO_PICK_UP_KEY = "auto-pick-up";
const PICKUP_STATS_KEY = "pickup-stats";

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
class PrStats {
  #pickupStats = GM_getValue(PICKUP_STATS_KEY, {});
  #platformIdSet = new Set();
  #scaledDenominator = 0;

  constructor() {
    if (!this.#pickupStats[this.#today()]) {
      this.#pickupStats[this.#today()] = {
        PRs: 0,
        Started: 0,
      };
    }
  }

  /**
   * Gets today's date as formatted string
   */
  #today = () => new Date().toISOString().split("T")[0];

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

    const prs = this.#pickupStats[this.#today()].PRs;
    const started = this.#pickupStats[this.#today()].Started;

    let scaleFactor = prs / started;
    this.#scaledDenominator = scaleFactor.toFixed(1);

    const lastPrTime = GM_getValue(LAST_PR_TIME_KEY);
    const timeDiff = ((Date.now() - lastPrTime) / 1000).toFixed(0);

    let nextPrTime = GM_getValue(PR_INTERVAL_KEY) - timeDiff;
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

    this.#pickupStats[this.#today()].PRs += difference.length;
    GM_setValue(PICKUP_STATS_KEY, this.#pickupStats);
  };

  /**
   * Call when picking up a PR to update stats accordingly
   */
  pickedUpPr = () => {
    this.#pickupStats[this.#today()].Started += 1;
    GM_setValue(PICKUP_STATS_KEY, this.#pickupStats);
  };

  /**
   * Gets the scaled denominator for picked up PRs (1 in every X)
   */
  getScaledDenominator = () => this.#scaledDenominator;
}

// ---------- GLOBAL VARIABLE INIT -------------
const Stats = new PrStats();

let autoPickUpMenuCommand;

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
  const lastPrTime = GM_getValue(LAST_PR_TIME_KEY);
  const timeDiff = Date.now() - lastPrTime;

  return timeDiff > GM_getValue(PR_INTERVAL_KEY) * 1000;
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

      GM_setValue(LAST_PR_TIME_KEY, currentTime);
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

  if (!GM_getValue(AUTO_PICK_UP_KEY)) {
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

      GM_setValue(LAST_PR_TIME_KEY, Date.now());
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

/**
 * Initializes the TamperMonkey storage values to the defaults if they don't exist
 */
function setInitialStorageValues() {
  GM_setValue(
    PR_INTERVAL_KEY,
    GM_getValue(PR_INTERVAL_KEY, DEFAULT_PR_INTERVAL)
  );
  GM_setValue(DING_URL_KEY, GM_getValue(DING_URL_KEY, DEFAULT_DING_URL));
  GM_setValue(LAST_PR_TIME_KEY, GM_getValue(LAST_PR_TIME_KEY, Date.now()));
  GM_setValue(AUTO_PICK_UP_KEY, GM_getValue(AUTO_PICK_UP_KEY, true));
}

/**
 * Registers the static TamperMonkey menu commands
 */
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

/**
 * Updates the dynamic TamperMonkey menu commands
 */
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

// ---------- SCRIPT ENTRY POINT -------------
(function () {
  "use strict";

  setInitialStorageValues();

  registerStaticMenuCommands();
  updateDynamicMenuCommends();

  startPageObserver();

  // Update the PR stats every second
  setInterval(Stats.display, 1000);

  console.log("Myrge PR Helper Running");
})();
