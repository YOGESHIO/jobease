const heroSearch = document.querySelector("#heroSearch");
const serviceSearch = document.querySelector("#serviceSearch");
const cards = Array.from(document.querySelectorAll(".service-card"));
const calcService = document.querySelector("#calcService");
const calcHours = document.querySelector("#calcHours");
const calcUrgency = document.querySelector("#calcUrgency");
const finalTotal = document.querySelector("#finalTotal");

function updateCards() {
  const query = serviceSearch.value.trim().toLowerCase();

  cards.forEach((card) => {
    const searchableText = `${card.textContent} ${card.dataset.keywords}`.toLowerCase();
    card.hidden = query && !searchableText.includes(query);
  });
}

function syncSearch() {
  serviceSearch.value = heroSearch.value;
  updateCards();
  document.querySelector("#services").scrollIntoView({ behavior: "smooth" });
}

function formatRupees(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function updateEstimate() {
  const selected = calcService.options[calcService.selectedIndex];
  const base = Number(calcService.value);
  const hourlyRate = Number(selected.dataset.rate);
  const hours = Math.max(1, Number(calcHours.value || 1));
  const urgency = Number(calcUrgency.value);
  const platformFee = 50;

  finalTotal.textContent = formatRupees(Math.round((base + hourlyRate * hours) * urgency + platformFee));
}

serviceSearch.addEventListener("input", updateCards);
heroSearch.addEventListener("search", syncSearch);
heroSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    syncSearch();
  }
});

[calcService, calcHours, calcUrgency].forEach((field) => {
  field.addEventListener("input", updateEstimate);
  field.addEventListener("change", updateEstimate);
});

updateCards();
updateEstimate();
