// ==UserScript==
// @name         Azure Pipelines PR AskChatGPT
// @namespace    http://piu.piuson.com/
// @version      1.0.2
// @description  Ask ChatGPT to review files on a PR in Azure Pipelines
// @author       Piu Piuson
// @downloadURL  https://raw.githubusercontent.com/PiuPiuson/azure-pipelines-PR-AskChatGPT/main/askChatgpt-button.js
// @updateURL    https://raw.githubusercontent.com/PiuPiuson/azure-pipelines-PR-AskChatGPT/main/askChatgpt-button.js
// @match        https://dev.azure.com/*/pullrequest/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=azure.com
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// ==/UserScript==

(function () {
  "use strict";

  const GPT_MODEL_4 = {
    name: "gpt-4-1106-preview",
    cost: {
      prompt: 0.01,
      completion: 0.03,
    },
  };

  const GPT_ENDPOINT = "https://api.openai.com/v1/chat/completions";

  const GPT_BUTTON_NAVBAR_ID = "gpt-button-navbar";
  const FILE_ELEMENT_SELECTOR = ".repos-summary-header";

  const SYSTEM_PROMPT = `Review the code and - only where improvements can be made - provide feedback on those improvements. 
  Only check the following areas:
   - Correctness: Is the code logically sound and free of bugs?
   - Clarity: Is the code easily readable to a developer who didn't write it?
   - Best Practices: Is the code written in a way that adheres to industry standards and best practices?
   - Speed: Are there any parts of the code that could be optimized for better performance?
   - Security: Are there any potential security vulnerabilities?
  Suggest refactoring or other improvements. If simple, put them in a \`\`\`suggestion <suggestion> \`\`\` tag within the comment body
  Feedback should be polite, professional and encouraging.
  The aim is to educate as well as to flag issues, so examples and explanations of the reasoning behind suggestions are very helpful.
  You are given the diff. Lines starting with + are added and - are removed.  If a line number is followed by another, treat the first as 'before' and the second as 'after'
  Only comment on the added lines. Only point out errors, don't praise good practices. Do not nitpick.
  Keep your responses short. Compile your feedback in a JSON format: {<lineNumber>: <comment>, <lineNumber>: <comment>}
`;

  const ASK_CHATGPT_BUTTON_HTML =
    '<div class="repos-pr-header-complete-button bolt-split-button flex-stretch inline-flex-row"><button class="ask-chatgpt bolt-split-button-main bolt-button bolt-icon-button enabled bolt-focus-treatment" data-is-focusable="true" role="button" tabindex="0" type="button" data-focuszone="focuszone-5"></span><span class="bolt-button-text body-m">Ask ChatGPT</span></button></div>';

  let API_KEY = GM_getValue("apiKey");

  function generateUUID() {
    return "axxxxxxxxxxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0,
        v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function configureApiKey() {
    if (!API_KEY) {
      API_KEY = prompt("Please enter your OpenAI API key:");
      GM_setValue("apiKey", API_KEY);
    }
  }

  function estimateGPT4Tokens(text) {
    // Regular expressions for common contractions and punctuations
    const contractionRegex = /(\w+\'\w+)|(\w+\'\w*\w+)/g;
    const punctuationRegex = /[\.,!?;:\(\)\[\]\"\'\-\—\–]/g;

    // Count contractions as single tokens
    let contractions = (text.match(contractionRegex) || []).length;

    // Remove contractions from text to avoid double counting
    let processedText = text.replace(contractionRegex, " ");

    // Splitting the text into words and punctuations as tokens
    let wordsAndPunctuations = processedText.split(/\s+/).filter(Boolean);
    let punctuationCount = (processedText.match(punctuationRegex) || []).length;

    return (
      (wordsAndPunctuations.length + punctuationCount - contractions) * 1.25
    );
  }

  function estimateGPT4TokensForJSON(jsonString) {
    // Regular expression for JSON special characters and string literals
    const specialCharsRegex = /[\{\}\[\],:]/g;
    const stringLiteralRegex = /"(?:\\.|[^"\\])*"/g;

    // Counting special JSON characters (brackets, braces, commas, colons) as separate tokens
    let specialCharCount = (jsonString.match(specialCharsRegex) || []).length;

    // Extracting and counting string literals
    let stringLiterals = jsonString.match(stringLiteralRegex) || [];
    let stringLiteralTokens = stringLiterals.reduce(
      (count, str) =>
        count +
        str.split(/\s+|(?=[,.!?;:])|(?<=[,.!?;:])/).filter(Boolean).length,
      0
    );

    // Removing string literals from the JSON string to avoid double counting
    let processedJSON = jsonString.replace(stringLiteralRegex, " ");

    // Splitting the remaining text into potential tokens
    let otherTokens = processedJSON.split(/\s+/).filter(Boolean).length;

    return (specialCharCount + stringLiteralTokens + otherTokens) * 1.25;
  }

  function queryChatGPT(prompt) {
    return new Promise((resolve, reject) => {
      const data = {
        model: GPT_MODEL_4.name,
        max_tokens: 4096,
        temperature: 0.8,
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify(prompt),
          },
        ],
      };

      // console.log("request", data);

      GM_xmlhttpRequest({
        method: "POST",
        url: GPT_ENDPOINT,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_KEY}`,
        },
        data: JSON.stringify(data),
        onload: function (response) {
          try {
            const responseData = JSON.parse(response.responseText);

            // console.log("response", responseData);

            const responseText = responseData.choices[0].message.content;
            const completionTokens = responseData.usage.completion_tokens;
            const promptTokens = responseData.usage.prompt_tokens;

            resolve({
              result: responseText,
              completionTokens: completionTokens,
              promptTokens: promptTokens,
            });
          } catch (error) {
            console.error("Error in parsing ChatGPT response:", error);
            console.error("Response: ", response);
            reject(error);
          }
        },
        onerror: function (error) {
          console.error("Error in ChatGPT request:", error);
          reject(error);
        },
      });
    });
  }

  async function sendFileCodeToChatGPT(code) {
    const codeJson = JSON.stringify(code);
    const response = await queryChatGPT(codeJson);

    const completionTokens = response.completionTokens;
    const promptTokens = response.promptTokens;

    const estimatedTokens =
      estimateGPT4Tokens(SYSTEM_PROMPT) + estimateGPT4TokensForJSON(codeJson);

    const completionCost =
      (completionTokens / 1000) * GPT_MODEL_4.cost.completion;
    const promptCost = (promptTokens / 1000) * GPT_MODEL_4.cost.prompt;
    const totalCost = completionCost + promptCost;

    const costMessage = `Request Cost: $${totalCost.toFixed(
      3
    )}\nPrompt: $${promptCost.toFixed(
      3
    )} (${promptTokens} tokens | estimated: ${estimatedTokens})\nCompletion: $${completionCost.toFixed(
      3
    )} (${completionTokens} tokens)`;

    console.log(costMessage);
    alert(costMessage);

    // console.log(response);

    return JSON.parse(response.result);
  }

  function getAllFileElements() {
    return document.querySelectorAll(FILE_ELEMENT_SELECTOR);
  }

  function getFileElementFromFileName(fileName) {
    const fileElements = getAllFileElements();

    for (const fileElement of fileElements) {
      const elementFileName = fileElement.querySelector(
        ".secondary-text.text-ellipsis"
      ).innerText;

      if (elementFileName === fileName) {
        return fileElement;
      }
    }

    return null; // Return null if no matching element is found
  }

  function extractCodeFromColumn(columnElement) {
    const changes = columnElement.querySelectorAll(
      ".repos-diff-contents-row.monospaced-text"
    );

    const columnChanges = Array.from(changes).map((change) => {
      if (change.classList.contains("repos-elliplis-row")) {
        return;
      }

      const lineNumber = change.querySelector(".secondary-text").innerText;
      let code = change.querySelector(".repos-line-content").innerText;

      if (code.trim() === "") {
        return;
      }

      if (code.startsWith("Plus")) {
        code = code.replace("Plus ", "+");
      } else if (code.startsWith("Minus")) {
        code = code.replace("Minus ", "-");
      } else {
        code = "  " + code;
      }

      return { [lineNumber]: code };
    }, {}); // Initialize the accumulator as an empty object

    return columnChanges;
  }

  function getBeforeColumn(fileElement) {
    return fileElement.querySelector(".vss-Splitter--pane-fixed");
  }

  function getAfterColumn(fileElement) {
    return fileElement.querySelector(".vss-Splitter--pane-flexible");
  }

  function getSingleColumnElement(fileElement) {
    return fileElement.querySelector(".repos-summary-diff-container");
  }

  function getFileName(fileElement) {
    return fileElement.querySelector(".secondary-text.text-ellipsis").innerText;
  }

  function getParentFileElement(childElement) {
    return childElement.closest(FILE_ELEMENT_SELECTOR);
  }

  function extractCodeFromFile(fileElement) {
    const codeElement = getSingleColumnElement(fileElement);
    if (!codeElement) {
      return;
    }

    return extractCodeFromColumn(codeElement);
  }

  // Function to extract code
  function extractCode() {
    // Find all file elements
    const fileElements = getAllFileElements();
    const fileData = [];

    fileElements.forEach(function (fileElement) {
      const fileName = getFileName(fileElement);
      const code = extractCodeFromFile(fileElement);

      fileData.push({
        fileName: fileName,
        code: code,
      });
    });

    return fileData;
  }

  function findElementByInnerText(parentElement, innerText) {
    return Array.from(parentElement.querySelectorAll("*")).find(
      (el) => el.innerText === innerText
    );
  }

  function addCommentToLine(fileElement, line, comment) {
    // console.log(`adding comment ${line}:${comment}`);

    const codeElement = getSingleColumnElement(fileElement);
    const numberElement = findElementByInnerText(codeElement, line);
    const lineElement = numberElement.parentElement;

    const addCommentElement = lineElement.querySelector(".screen-reader-only");
    addCommentElement.click();

    setTimeout(() => {
      const commentElement = lineElement.nextElementSibling;
      const textArea = commentElement.querySelector(
        "[id^='__bolt-textfield-input']"
      );
      textArea.value = comment;
    }, 200);
  }

  async function addCommentsToFile(fileElement, comments) {
    for (const [lineNumber, comment] of Object.entries(comments)) {
      addCommentToLine(fileElement, lineNumber, comment);
      await waitForSpaceBarPress();
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async function addComments(comments) {
    for (const [fileName, commentsObject] of Object.entries(comments)) {
      // console.log(`File: ${fileName}`);
      // console.log(commentsObject);

      const fileElement = getFileElementFromFileName(fileName);
      await addCommentsToFile(fileElement, commentsObject);
    }
  }

  function waitForSpaceBarPress() {
    return new Promise((resolve, reject) => {
      // Event listener for the keydown event
      function keydownHandler(event) {
        if (event.code === "Space") {
          document.removeEventListener("keydown", keydownHandler);
          resolve();
        }
      }

      document.addEventListener("keydown", keydownHandler);
    });
  }

  function createGPTButton(id) {
    const newElement = document
      .createRange()
      .createContextualFragment(ASK_CHATGPT_BUTTON_HTML);

    newElement.firstChild.firstChild.id = id;

    return newElement;
  }

  function addGPTButtonToNavBar() {
    const navBar = document.querySelector(
      ".flex-row.rhythm-horizontal-8.flex-center.flex-grow"
    );

    const buttonId = GPT_BUTTON_NAVBAR_ID;

    navBar.insertBefore(createGPTButton(buttonId), navBar.children[1]);

    const button = navBar.querySelector(`#${buttonId}`);
    button.addEventListener("click", onGPTButtonClick);
  }

  function addGPTButtonToFile(fileElement) {
    const navBar = fileElement.querySelector(".flex-row.flex-grow.justify-end");

    const buttonId = generateUUID();

    navBar.insertBefore(createGPTButton(buttonId), navBar.children[0]);

    const button = navBar.querySelector(`#${buttonId}`);
    button.style.marginRight = "10px";
    button.addEventListener("click", onGPTButtonClick);
  }

  function addGPTButtonToAllFiles() {
    const fileElements = getAllFileElements();

    fileElements.forEach((fileElement) => {
      addGPTButtonToFile(fileElement);
    });
  }

  function disableButton(buttonElement) {
    buttonElement.disabled = true;
    buttonElement.classList.add("disabled");
    buttonElement.classList.remove("enabled");
  }

  function enableButton(buttonElement) {
    buttonElement.disabled = false;
    buttonElement.classList.add("enabled");
    buttonElement.classList.remove("disabled");
  }

  function onGPTButtonClick() {
    // const code = extractCode();
    // console.log(JSON.stringify(code));

    disableButton(this);

    if (this.id === GPT_BUTTON_NAVBAR_ID) {
      console.log("Navbar!");
      return;
    }
    const fileElement = getParentFileElement(this);
    const code = extractCodeFromFile(fileElement);

    // console.log(code);

    sendFileCodeToChatGPT(code)
      .then((response) => {
        const comments = response;
        console.log("gpt results", comments);

        addCommentsToFile(fileElement, comments).then(() => {
          enableButton(this);
        });
      })
      .catch((e) => console.log(e));
  }

  function startPageObserver() {
    const observerConfig = { childList: true, subtree: true };
    const observerTarget = document.body;

    // Create a MutationObserver to monitor changes to the page
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === "childList" && mutation.addedNodes.length) {
          // Check if we are in the files page and add the button
          const changeText = mutation.addedNodes[0].innerText;
          if (changeText?.includes("All Changes")) {
            addGPTButtonToAllFiles();
          }
        }
      });
    });

    observer.observe(observerTarget, observerConfig);
  }

  function onPageLoad() {
    // addGPTButtonToNavBar();
    addGPTButtonToAllFiles();
    configureApiKey();
    startPageObserver();
  }

  window.addEventListener("load", onPageLoad);
})();
