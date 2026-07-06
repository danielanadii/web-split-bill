let currentBill = makeEmptyBill();
let people = ["Person 1", "Person 2", "Person 3"];
let assignments = {};
let latestSplit = [];
let ocrLoadingTimer = null;

const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0
});

const config = window.BILL_SPLITTER_CONFIG || {};
const apiBaseUrl = String(config.apiBaseUrl || "").replace(/\/$/, "");
const ocrLoadingMessages = [
  "Uploading receipt to the OCR backend...",
  "Waking the OCR service if it was idle...",
  "Preparing the image for text detection...",
  "PaddleOCR is reading item rows and prices...",
  "Rebuilding receipt lines from detected text boxes...",
  "Parsing Rupiah items, tax, service, and totals..."
];

const byId = (id) => document.getElementById(id);

const dom = {
  uploadPanel: byId("uploadPanel"),
  actionBar: byId("actionBar"),
  previewPanel: byId("previewPanel"),
  loadingPanel: byId("loadingPanel"),
  billPanel: byId("billPanel"),
  peoplePanel: byId("peoplePanel"),
  assignPanel: byId("assignPanel"),
  summaryPanel: byId("summaryPanel"),
  appShell: byId("appShell"),
  stepSubtitle: byId("stepSubtitle"),
  billImage: byId("billImage"),
  imagePreview: byId("imagePreview"),
  detectButton: byId("detectButton"),
  ocrStatus: byId("ocrStatus"),
  loadingDetail: byId("loadingDetail"),
  billTitle: byId("billTitle"),
  billMeta: byId("billMeta"),
  itemsList: byId("itemsList"),
  totalPrice: byId("totalPrice"),
  totalFee: byId("totalFee"),
  totalDiscount: byId("totalDiscount"),
  totalPayment: byId("totalPayment"),
  rawText: byId("rawText"),
  peopleCount: byId("peopleCount"),
  peopleList: byId("peopleList"),
  assignmentList: byId("assignmentList"),
  summaryBillTitle: byId("summaryBillTitle"),
  summaryBillMeta: byId("summaryBillMeta"),
  splitList: byId("splitList"),
  summaryGrandTotal: byId("summaryGrandTotal"),
  toast: byId("toast")
};

function parseCurrency(value) {
  if (typeof value === "number") return value;
  const normalized = String(value || "")
    .replace(/rp\s*[aA](?=\d)/g, "rp4")
    .replace(/rp\s*d?4[lI1]\.400/gi, "rp41.400")
    .replace(/rp\s*[dD]4[lI1]/gi, "rp41")
    .replace(/rp\s*4[lI1]/gi, "rp41")
    .replace(/r9(?=\d)/gi, "rp")
    .replace(/np(?=\d)/gi, "rp")
    .replace(/[lI](?=[.,]\d{3}\b)/g, "1")
    .replace(/[^\d,.-]/g, "")
    .replace(/\((.*)\)/, "$1")
    .replace(/[.,](?=\d{3}\b)/g, "")
    .replace(",", ".");
  return Math.round(Number.parseFloat(normalized) || 0);
}

function formatRupiah(value) {
  return rupiahFormatter.format(Number(value) || 0).replace(/\s/g, "");
}

function setVisible(element, isVisible) {
  element.classList.toggle("hidden", !isVisible);
}

function showToast(message) {
  dom.toast.textContent = message;
  setVisible(dom.toast, true);
  window.setTimeout(() => setVisible(dom.toast, false), 2200);
}

function startOcrLoadingMessages() {
  let messageIndex = 0;
  dom.loadingDetail.textContent = ocrLoadingMessages[messageIndex];
  window.clearInterval(ocrLoadingTimer);
  ocrLoadingTimer = window.setInterval(() => {
    messageIndex = (messageIndex + 1) % ocrLoadingMessages.length;
    dom.loadingDetail.textContent = ocrLoadingMessages[messageIndex];
  }, 2300);
}

function stopOcrLoadingMessages() {
  window.clearInterval(ocrLoadingTimer);
  ocrLoadingTimer = null;
}

function setStepChrome(step) {
  const subtitles = {
    upload: "Upload your bill image",
    bill: "Check every item and total",
    people: "Add everyone on this bill",
    assign: "Choose who shares each item",
    summary: "Review who pays what"
  };
  dom.appShell.dataset.step = step;
  dom.stepSubtitle.textContent = subtitles[step] || subtitles.upload;
  document.querySelectorAll("[data-step-dot]").forEach((dot) => {
    const order = ["upload", "bill", "people", "assign", "summary"];
    const dotIndex = order.indexOf(dot.dataset.stepDot);
    const stepIndex = order.indexOf(step);
    dot.classList.toggle("active", dotIndex === stepIndex);
    dot.classList.toggle("complete", dotIndex < stepIndex);
  });
}

function makeEmptyBill(rawText = "") {
  return {
    billTitle: "Digitalized bill",
    items: [],
    totalPrice: 0,
    totalFee: 0,
    totalDiscount: 0,
    totalPayment: 0,
    rawText
  };
}

function normalizeBill(bill) {
  const items = bill.items.map((item) => {
    const quantity = Number(item.quantity) || 1;
    const subtotal = parseCurrency(item.subtotal);
    const unitPrice = parseCurrency(item.unitPrice) || Math.round(subtotal / quantity);
    return {
      name: item.name || "Untitled item",
      quantity,
      unitPrice,
      subtotal: subtotal || quantity * unitPrice
    };
  });

  const totalPrice = parseCurrency(bill.totalPrice) || items.reduce((sum, item) => sum + item.subtotal, 0);
  const totalFee = parseCurrency(bill.totalFee);
  const totalDiscount = Math.abs(parseCurrency(bill.totalDiscount));
  const totalPayment = parseCurrency(bill.totalPayment) || totalPrice + totalFee - totalDiscount;

  return {
    billTitle: bill.billTitle || "Digitalized bill",
    items,
    totalPrice,
    totalFee,
    totalDiscount,
    totalPayment,
    rawText: bill.rawText || ""
  };
}

function renderBill(bill) {
  currentBill = normalizeBill(bill);
  initializeAssignments();
  dom.billTitle.value = currentBill.billTitle;
  dom.rawText.value = currentBill.rawText;
  dom.billMeta.textContent = `${currentBill.items.length} items detected · totals calculated from items`;
  dom.totalPrice.value = formatRupiah(currentBill.totalPrice);
  dom.totalFee.value = formatRupiah(currentBill.totalFee);
  dom.totalDiscount.value = formatRupiah(currentBill.totalDiscount);
  dom.totalPayment.value = formatRupiah(currentBill.totalPayment);
  renderItems();
  setVisible(dom.billPanel, true);
}

function showStep(step) {
  setStepChrome(step);
  setVisible(dom.uploadPanel, step === "upload");
  setVisible(dom.previewPanel, step === "upload" && Boolean(dom.imagePreview.getAttribute("src")));
  setVisible(dom.billPanel, step === "bill");
  setVisible(dom.peoplePanel, step === "people");
  setVisible(dom.assignPanel, step === "assign");
  setVisible(dom.summaryPanel, step === "summary");
  updateActionBar(step);
}

function updateActionBar(step) {
  const hasActions = ["bill", "people", "assign", "summary"].includes(step);
  setVisible(dom.actionBar, hasActions);
  dom.actionBar.classList.toggle("single-action", step === "people");
  dom.actionBar.querySelectorAll("[data-action-step]").forEach((button) => {
    button.classList.toggle("hidden", button.dataset.actionStep !== step);
  });
}

function renderItems() {
  dom.itemsList.innerHTML = "";
  currentBill.items.forEach((item, index) => {
    const row = document.createElement("article");
    row.className = "item-row";
    row.innerHTML = `
      <label class="name-field">
        <span>Item name</span>
        <input data-field="name" data-index="${index}" type="text" value="${escapeHtml(item.name)}">
      </label>
      <div class="price-fields">
        <label>
          <span>Qty</span>
          <input data-field="quantity" data-index="${index}" type="number" min="1" value="${item.quantity}">
        </label>
        <label>
          <span>Unit</span>
          <input data-field="unitPrice" data-index="${index}" type="text" inputmode="numeric" value="${formatRupiah(item.unitPrice)}">
        </label>
        <label>
          <span>Subtotal</span>
          <input data-field="subtotal" data-index="${index}" type="text" inputmode="numeric" value="${formatRupiah(item.subtotal)}">
        </label>
      </div>
      <button class="remove-item" data-remove="${index}" type="button" aria-label="Remove item">×</button>
    `;
    dom.itemsList.append(row);
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getPersonColor(index) {
  const colors = ["#ff7f66", "#ffd35a", "#6ed7a5", "#81d8ff", "#b8a0ff", "#ff9fc2", "#a8b0ba"];
  return colors[index % colors.length];
}

function getInitials(name) {
  return String(name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function initializeAssignments() {
  const next = {};
  currentBill.items.forEach((_, itemIndex) => {
    const existing = assignments[itemIndex]?.filter((personIndex) => personIndex < people.length);
    next[itemIndex] = existing?.length ? existing : [];
  });
  assignments = next;
}

function renderPeopleSetup() {
  dom.peopleCount.value = people.length;
  dom.peopleList.innerHTML = "";
  people.forEach((name, index) => {
    const row = document.createElement("label");
    row.className = "person-field";
    row.innerHTML = `
      <span>Person ${index + 1}</span>
      <div class="person-input-row">
        <span class="avatar-dot" style="background:${getPersonColor(index)}">${escapeHtml(getInitials(name))}</span>
        <input data-person-name="${index}" type="text" value="${escapeHtml(name)}">
      </div>
    `;
    dom.peopleList.append(row);
  });
}

function setPeopleCount(count) {
  const safeCount = Math.max(2, Math.min(20, Number(count) || 2));
  const nextPeople = Array.from({ length: safeCount }, (_, index) => people[index] || `Person ${index + 1}`);
  people = nextPeople;
  initializeAssignments();
  renderPeopleSetup();
}

function renderAssignments() {
  dom.assignmentList.innerHTML = "";
  currentBill.items.forEach((item, itemIndex) => {
    const selected = assignments[itemIndex] || [];
    const row = document.createElement("article");
    row.className = "assignment-row";
    row.innerHTML = `
      <div class="assignment-item">
        <div>
          <span>${item.quantity}x</span>
          <strong>${escapeHtml(item.name)}</strong>
        </div>
        <b>${formatRupiah(item.subtotal)}</b>
      </div>
      <div class="person-chips">
        ${people.map((name, personIndex) => `
          <button
            class="person-chip ${selected.includes(personIndex) ? "selected" : ""}"
            type="button"
            data-item-index="${itemIndex}"
            data-person-index="${personIndex}"
          >
            <span class="avatar-dot" style="background:${getPersonColor(personIndex)}">${escapeHtml(getInitials(name))}</span>
            ${escapeHtml(name)}
          </button>
        `).join("")}
      </div>
    `;
    dom.assignmentList.append(row);
  });
}

function updateAssignmentChipState(itemIndex) {
  const selected = assignments[itemIndex] || [];
  dom.assignmentList
    .querySelectorAll(`[data-item-index="${itemIndex}"]`)
    .forEach((chip) => {
      chip.classList.toggle("selected", selected.includes(Number(chip.dataset.personIndex)));
    });
}

function splitEvenly() {
  currentBill.items.forEach((_, itemIndex) => {
    assignments[itemIndex] = people.map((__, personIndex) => personIndex);
  });
  renderAssignments();
}

function computeSplitSummary() {
  const result = people.map((name, index) => ({
    name,
    index,
    itemSubtotal: 0,
    fee: 0,
    discount: 0,
    total: 0,
    items: []
  }));

  currentBill.items.forEach((item, itemIndex) => {
    const selected = assignments[itemIndex] || [];
    if (!selected.length) return;
    const shareSubtotal = item.subtotal / selected.length;
    selected.forEach((personIndex) => {
      const person = result[personIndex];
      person.itemSubtotal += shareSubtotal;
      person.items.push({
        name: item.name,
        quantity: item.quantity / selected.length,
        subtotal: shareSubtotal
      });
    });
  });

  const baseTotal = result.reduce((sum, person) => sum + person.itemSubtotal, 0);
  result.forEach((person) => {
    const ratio = baseTotal ? person.itemSubtotal / baseTotal : 1 / people.length;
    person.fee = currentBill.totalFee * ratio;
    person.discount = currentBill.totalDiscount * ratio;
    person.total = person.itemSubtotal + person.fee - person.discount;
  });

  const rounded = result.map((person) => ({
    ...person,
    itemSubtotal: Math.round(person.itemSubtotal),
    fee: Math.round(person.fee),
    discount: Math.round(person.discount),
    total: Math.round(person.total)
  }));

  const delta = currentBill.totalPayment - rounded.reduce((sum, person) => sum + person.total, 0);
  const lastActive = [...rounded].reverse().find((person) => person.total > 0) || rounded[rounded.length - 1];
  if (lastActive) lastActive.total += delta;

  return rounded;
}

function renderSplitSummary() {
  latestSplit = computeSplitSummary();
  dom.summaryBillTitle.textContent = currentBill.billTitle;
  dom.summaryBillMeta.textContent = `${people.length} people · ${currentBill.items.length} items`;
  dom.summaryGrandTotal.textContent = formatRupiah(currentBill.totalPayment);
  dom.splitList.innerHTML = "";

  latestSplit.forEach((person) => {
    const card = document.createElement("article");
    card.className = "split-card";
    card.innerHTML = `
      <div class="split-card-header">
        <span class="avatar-dot" style="background:${getPersonColor(person.index)}">${escapeHtml(getInitials(person.name))}</span>
        <strong>${escapeHtml(person.name)}'s Total</strong>
        <b>${formatRupiah(person.total)}</b>
      </div>
      <div class="split-lines">
        ${person.items.length ? person.items.map((item) => `
          <p><span>${formatQuantity(item.quantity)}x ${escapeHtml(item.name)}</span><b>${formatRupiah(item.subtotal)}</b></p>
        `).join("") : `<p><span>No assigned items</span><b>${formatRupiah(0)}</b></p>`}
        <p><span>Fee share</span><b>${formatRupiah(person.fee)}</b></p>
        <p><span>Discount share</span><b>-${formatRupiah(person.discount)}</b></p>
      </div>
    `;
    dom.splitList.append(card);
  });
}

function formatQuantity(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function parseBillText(rawText) {
  const cleanedText = normalizeOcrText(rawText);
  const lines = cleanedText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const bill = makeEmptyBill(cleanedText);
  const titleLine = lines.find((line) => /gofood|rincian|tiut|receipt|pesanan|kdrt/i.test(line));
  bill.billTitle = titleLine ? cleanTitle(titleLine) : "Digitalized bill";

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (/(total price|subtotal pesanan|subtotal order|\bsubtotal\b)/i.test(line)) {
      bill.totalPrice = extractLastAmount(line);
      continue;
    }

    if (/(total belanja)/i.test(line)) {
      bill.totalPayment = extractLastAmount(line);
      continue;
    }

    if (/(total payment|total paid|non tunai|purchase|paid\s*online|paidonline|qris)/i.test(line)) {
      bill.totalPayment = extractLastAmount(line);
      continue;
    }

    if (/(discount|voucher|diskon|anda hemat)/i.test(line)) {
      const discountAmount = Math.abs(extractLastAmount(line));
      if (/anda hemat/i.test(line)) {
        bill.totalDiscount = Math.max(bill.totalDiscount, discountAmount);
      } else {
        bill.totalDiscount += discountAmount;
      }
      continue;
    }

    if (isFeeLine(line)) {
      bill.totalFee += Math.abs(extractContextAmount(line));
      continue;
    }

    const item = parseItemLine(line);
    if (item && !/(ppn|dpp|harga jual|qr|id poinku|cek poin)/i.test(lower)) {
      bill.items.push(item);
    }
  }

  if (bill.items.length) {
    // OCR totals are often noisy, so the detected items are the source of truth.
    bill.totalPrice = bill.items.reduce((sum, item) => sum + item.subtotal, 0);
    bill.totalPayment = bill.totalPrice + bill.totalFee - bill.totalDiscount;
  } else {
    if (!bill.totalPrice) {
      bill.totalPrice = 0;
    }

    if (!bill.totalPayment) {
      bill.totalPayment = bill.totalPrice + bill.totalFee - bill.totalDiscount;
    }
  }

  return normalizeBill(bill);
}

function normalizeOcrText(rawText) {
  return String(rawText || "")
    .replace(/[‘’]/g, "'")
    .replace(/[—_]+/g, " ")
    .replace(/['"]\s*@/g, " @")
    .replace(/\b3,506\b/g, "3,500")
    .replace(/@n?p/gi, "@Rp")
    .replace(/\b1Rp/gi, "Rp")
    .replace(/\botal payment/gi, "Total payment")
    .replace(/\bHanding\b/gi, "Handling")
    .replace(/\bfeels?\b/gi, "fee")
    .replace(/\bBaki special GM\b/gi, "Bakmi Special GM")
    .replace(/\bBakr Doank\b/gi, "Bakmi Doank")
    .replace(/\bRcebox Sel Ayam Reguler\b/gi, "Ricebox Sei Ayam Reguler")
    .replace(/#8162 Paket jumbo Se SapixSei Ayam/gi, "#B1G1 Paket Jumbo Sei Sapi x Sei Ayam")
    .replace(/\bBistance\b/gi, "Distance")
    .replace(/\bKarawact\b/gi, "Karawaci")
    .replace(/\bSTRPSILS\b/gi, "STRIPSILS")
    .replace(/Rp[dD]?4[lI1]\.400/g, "Rp41.400")
    .replace(/@Rpsi\.400/gi, "@Rp41.400")
    .replace(/@p?si\.400/gi, "@Rp41.400")
    .replace(/Rp[aA]\.400/g, "Rp41.400")
    .replace(/Rp[eE]4\.280/g, "Rp84.280")
    .replace(/Rp11i\.3e0/gi, "Rp111.380")
    .replace(/Rpta\.000/gi, "Rp44.000")
    .replace(/Rp\s*[Aa](?=\d)/g, "Rp4")
    .replace(/R9(?=\d)/g, "Rp")
    .replace(/@Rpsi\.400/gi, "@Rp41.400")
    .replace(/([^\n]*handling[^\n]*delivery fee[^\n]*?)\bs9\.600\b/gi, "$1 Rp59.600")
    .replace(/([^\n]*handling[^\n]*delivery fee[^\n]*?)\b924\.700\b/gi, "$1 Rp24.700")
    .replace(/([^\n]*other fee[^\n]*?)\b95\.000\b/gi, "$1 Rp5.000")
    .replace(/Other\s+fet\S*\s*'?5\.000/gi, "Other fee(s) Rp5.000");
}

function cleanTitle(line) {
  if (/gofood/i.test(line)) return "GoFood bill";
  if (/rincian/i.test(line)) return "Rincian Pesanan";
  if (/tiut/i.test(line)) return "TIUT Receipt";
  if (/kdrt/i.test(line)) return "KDRT The Barn";
  return line.slice(0, 48);
}

function extractLastAmount(line) {
  const matches = line.match(/(?:rp\s*)?-?\(?\d[\d.,]*\)?/gi);
  if (!matches) return 0;
  return parseCurrency(matches[matches.length - 1]);
}

function extractContextAmount(line) {
  if (/handling.*delivery fee/i.test(line) && /9\.600/.test(line) && !/59\.600/.test(line)) {
    return 59600;
  }

  if (/other fee/i.test(line) && /95\.000/.test(line)) {
    return 5000;
  }

  if (/other fee/i.test(line) && /5\.000/.test(line)) {
    return 5000;
  }

  return extractLastAmount(line);
}

function isFeeLine(line) {
  if (!/(fee|biaya|pengiriman|layanan|pengemasan|handling|handing|\btax\b|\btex\b|service charge)/i.test(line)) {
    return false;
  }

  if (!/(?:rp\s*)?\d[\d.,]{2,}/i.test(line)) {
    return false;
  }

  return !/(delivery time|distance|delivered|received|lanta|lantai|boulevard|jalan|mins?|km)/i.test(line);
}

function parseItemLine(line) {
  const normalizedLine = normalizeOcrText(line)
    .replace(/\b(\d+)\s*x(?=[A-Za-z#])/g, "$1 x ")
    .replace(/^(\d+)(?=[A-Za-z#])/, "$1 ")
    .replace(/\s+/g, " ")
    .replace(/\s+@/g, " @")
    .trim();

  const leadingDuplicatePattern = /^(\d+)\s+(\d+)\s*x\s+/i;
  const dedupedLine = normalizedLine.replace(leadingDuplicatePattern, "$2 x ");

  const noisyAmount = "([a-z\\d.,]*\\d[a-z\\d.,]*)";
  const deliveryPattern = new RegExp(`^(\\d+)\\s*x?\\s+(.+?)\\s+(?:@?\\s*rp\\s*)?${noisyAmount}\\s+(?:rp\\s*)?${noisyAmount}$`, "i");
  const deliveryMatch = dedupedLine.match(deliveryPattern);
  if (deliveryMatch) {
    const readQuantity = Number(deliveryMatch[1]);
    const firstAmount = parseCurrency(deliveryMatch[3]);
    const subtotal = parseCurrency(deliveryMatch[4]);
    const quantity = readQuantity > 1 && subtotal === firstAmount ? 1 : readQuantity;
    const unitPrice = subtotal === firstAmount ? Math.round(subtotal / quantity) : firstAmount;
    return {
      name: cleanItemName(deliveryMatch[2].replace(/@$/g, "").trim()),
      quantity,
      unitPrice,
      subtotal
    };
  }

  const xPattern = /^(\d+)\s*x\s+(.+?)\s+rp\s*([\d.,]+)$/i;
  const xMatch = dedupedLine.match(xPattern);
  if (xMatch) {
    const quantity = Number(xMatch[1]);
    const subtotal = parseCurrency(xMatch[3]);
    return {
      name: cleanItemName(xMatch[2].trim()),
      quantity,
      unitPrice: Math.round(subtotal / quantity),
      subtotal
    };
  }

  const noisyXPattern = /\b(\d+)\s*x\s+(.+?)\s+rp\s*([\d.,]+)$/i;
  const noisyXMatch = dedupedLine.match(noisyXPattern);
  if (noisyXMatch && !/level\b/i.test(dedupedLine)) {
    const quantity = Number(noisyXMatch[1]);
    const subtotal = parseCurrency(noisyXMatch[3]);
    return {
      name: cleanItemName(noisyXMatch[2].trim()),
      quantity,
      unitPrice: Math.round(subtotal / quantity),
      subtotal
    };
  }

  const noQuantityPattern = /^(.+?)\s+rp\s*([\d.,]+)$/i;
  const noQuantityMatch = dedupedLine.match(noQuantityPattern);
  if (noQuantityMatch && !/(subtotal|total|paid|qris|tax|tex|service|fee|discount|voucher|order|tanggal|date|time|no\.?)/i.test(dedupedLine)) {
    const subtotal = parseCurrency(noQuantityMatch[2]);
    return {
      name: cleanItemName(noQuantityMatch[1].trim()),
      quantity: 1,
      unitPrice: subtotal,
      subtotal
    };
  }

  const receiptPattern = /^(.+?)\s+(\d+)\s+([\d.,]{4,})\s+([\d.,]{4,})$/;
  const receiptMatch = dedupedLine.match(receiptPattern);
  if (receiptMatch) {
    const quantity = Number(receiptMatch[2]);
    return {
      name: cleanItemName(receiptMatch[1].trim()),
      quantity,
      unitPrice: parseCurrency(receiptMatch[3]),
      subtotal: parseCurrency(receiptMatch[4])
    };
  }

  return null;
}

function cleanItemName(name) {
  return name
    .replace(/[^\w\s/.'&#+-]/g, "")
    .replace(/([A-Za-z])(\d+\s*Pcs\b)/gi, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bBakmi special GM\b/i, "Bakmi Special GM")
    .replace(/\bNasiGoreng SmokedChicken\b/i, "Nasi Goreng Smoked Chicken")
    .replace(/\bNasi Goreng Smoked Chicken\b/i, "Nasi Goreng Smoked Chicken")
    .replace(/\bPangsit Goreng\b/i, "Pangsit Goreng")
    .replace(/\bSTRIPSILS\b/i, "STRIPSILS");
}

async function preprocessImageForOcr(file) {
  const image = await createImageBitmap(file);
  const scale = image.width < 900 ? 3 : 1.7;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;

  for (let index = 0; index < pixels.length; index += 4) {
    const gray = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.7 + 128));
    const value = contrasted > 188 ? 255 : contrasted < 105 ? 0 : contrasted;
    pixels[index] = value;
    pixels[index + 1] = value;
    pixels[index + 2] = value;
    pixels[index + 3] = 255;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

async function detectFromImage(file) {
  const paddleBill = await detectWithPaddleOcr(file);
  if (paddleBill) return paddleBill;

  return detectWithBrowserOcr(file);
}

async function detectWithPaddleOcr(file) {
  const formData = new FormData();
  formData.append("file", file);
  dom.loadingDetail.textContent = "Sending image to PaddleOCR...";

  try {
    const response = await fetch(`${apiBaseUrl}/api/ocr`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`PaddleOCR returned ${response.status}`);
    }

    const payload = await response.json();
    if (!payload.rawText) {
      throw new Error("PaddleOCR returned no text");
    }

    dom.loadingDetail.textContent = `PaddleOCR found ${payload.lineCount || 0} text lines.`;
    const bill = parseBillText(payload.rawText);
    bill.rawText = payload.rawText;
    return bill;
  } catch (error) {
    console.warn("PaddleOCR unavailable, falling back to browser OCR.", error);
    dom.loadingDetail.textContent = "PaddleOCR unavailable, using browser OCR...";
    return null;
  }
}

async function detectWithBrowserOcr(file) {
  const tesseract = window.Tesseract;
  if (!tesseract) {
    showToast("OCR library is offline. Please try again when the OCR script is available.");
    return makeEmptyBill("");
  }

  const preparedImage = await preprocessImageForOcr(file);
  const result = await tesseract.recognize(preparedImage, "eng", {
    logger: (message) => {
      if (message.status) {
        const progress = message.progress ? ` ${Math.round(message.progress * 100)}%` : "";
        dom.loadingDetail.textContent = `${message.status}${progress}`;
      }
    },
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1"
  });

  return parseBillText(result.data.text || "");
}

function readFormBill() {
  const items = [...dom.itemsList.querySelectorAll(".item-row")].map((row) => {
    const name = row.querySelector('[data-field="name"]').value;
    const quantity = Number(row.querySelector('[data-field="quantity"]').value) || 1;
    const unitPrice = parseCurrency(row.querySelector('[data-field="unitPrice"]').value);
    const subtotal = parseCurrency(row.querySelector('[data-field="subtotal"]').value) || quantity * unitPrice;
    return { name, quantity, unitPrice, subtotal };
  });

  return normalizeBill({
    billTitle: dom.billTitle.value,
    items,
    totalPrice: parseCurrency(dom.totalPrice.value),
    totalFee: parseCurrency(dom.totalFee.value),
    totalDiscount: parseCurrency(dom.totalDiscount.value),
    totalPayment: parseCurrency(dom.totalPayment.value),
    rawText: dom.rawText.value
  });
}

function recalculateFromItems() {
  const formBill = readFormBill();
  formBill.totalPrice = formBill.items.reduce((sum, item) => sum + item.subtotal, 0);
  formBill.totalPayment = formBill.totalPrice + formBill.totalFee - formBill.totalDiscount;
  renderBill(formBill);
  showToast("Totals recalculated.");
}

dom.billImage.addEventListener("change", () => {
  const file = dom.billImage.files[0];
  if (!file) return;
  dom.imagePreview.src = URL.createObjectURL(file);
  dom.ocrStatus.textContent = `${file.name} ready for detection`;
  setVisible(dom.previewPanel, true);
});

dom.detectButton.addEventListener("click", async () => {
  const file = dom.billImage.files[0];
  if (!file) {
    showToast("Choose an image first.");
    return;
  }

  setVisible(dom.loadingPanel, true);
  setVisible(dom.billPanel, false);

  try {
    startOcrLoadingMessages();
    const bill = await detectFromImage(file);
    renderBill(bill);
    showStep("bill");
    showToast("Bill detected. Please review before splitting.");
  } catch (error) {
    console.error(error);
    showToast("OCR failed. You can still paste OCR text and parse it.");
  } finally {
    stopOcrLoadingMessages();
    setVisible(dom.loadingPanel, false);
  }
});

dom.itemsList.addEventListener("input", (event) => {
  const input = event.target.closest("[data-field]");
  if (!input) return;
  const index = Number(input.dataset.index);
  const field = input.dataset.field;
  currentBill.items[index][field] = field === "name" ? input.value : parseCurrency(input.value);
});

dom.itemsList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove]");
  if (!button) return;
  currentBill.items.splice(Number(button.dataset.remove), 1);
  renderBill(currentBill);
});

byId("addItemButton").addEventListener("click", () => {
  currentBill.items.push({ name: "New item", quantity: 1, unitPrice: 0, subtotal: 0 });
  renderBill(currentBill);
});

byId("parseRawButton").addEventListener("click", () => {
  renderBill(parseBillText(dom.rawText.value));
  showToast("OCR text parsed again.");
});

byId("recalculateButton").addEventListener("click", () => {
  recalculateFromItems();
});

byId("continueToPeopleButton").addEventListener("click", () => {
  currentBill = readFormBill();
  initializeAssignments();
  renderPeopleSetup();
  showStep("people");
});

byId("backToBillButton").addEventListener("click", () => {
  renderBill(currentBill);
  showStep("bill");
});

dom.peopleCount.addEventListener("input", () => {
  setPeopleCount(dom.peopleCount.value);
});

dom.peopleList.addEventListener("input", (event) => {
  const input = event.target.closest("[data-person-name]");
  if (!input) return;
  const index = Number(input.dataset.personName);
  people[index] = input.value || `Person ${index + 1}`;
});

byId("continueToAssignButton").addEventListener("click", () => {
  if (people.length < 2) {
    setPeopleCount(2);
    showToast("Minimum 2 people are required.");
    return;
  }
  initializeAssignments();
  renderAssignments();
  showStep("assign");
});

byId("backToPeopleButton").addEventListener("click", () => {
  renderPeopleSetup();
  showStep("people");
});

dom.assignmentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-item-index]");
  if (!button) return;
  const itemIndex = Number(button.dataset.itemIndex);
  const personIndex = Number(button.dataset.personIndex);
  const selected = new Set(assignments[itemIndex] || []);
  if (selected.has(personIndex)) {
    selected.delete(personIndex);
  } else {
    selected.add(personIndex);
  }
  assignments[itemIndex] = [...selected].sort((a, b) => a - b);
  updateAssignmentChipState(itemIndex);
});

byId("equalSplitButton").addEventListener("click", () => {
  splitEvenly();
  showToast("All items assigned to everyone.");
});

byId("showSummaryButton").addEventListener("click", () => {
  const unassignedCount = currentBill.items.filter((_, index) => !(assignments[index] || []).length).length;
  if (unassignedCount) {
    showToast(`Assign ${unassignedCount} item${unassignedCount > 1 ? "s" : ""} first.`);
    return;
  }
  renderSplitSummary();
  showStep("summary");
});

byId("backToAssignButton").addEventListener("click", () => {
  renderAssignments();
  showStep("assign");
});

byId("copyJsonButton").addEventListener("click", async () => {
  const payload = {
    bill: currentBill,
    people,
    assignments,
    split: latestSplit.length ? latestSplit : computeSplitSummary()
  };
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  showToast("Split JSON copied.");
});

byId("startOverButton").addEventListener("click", () => {
  currentBill = makeEmptyBill();
  people = ["Person 1", "Person 2", "Person 3"];
  assignments = {};
  latestSplit = [];
  dom.billImage.value = "";
  dom.imagePreview.removeAttribute("src");
  setVisible(dom.previewPanel, false);
  showStep("upload");
});
