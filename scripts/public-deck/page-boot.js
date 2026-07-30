const LABELS = {
  it: { deck: "Mazzo", cards: total => total + " carte" },
  en: { deck: "Deck", cards: total => total + " cards" }
};
let themeId = "t01";
let localeId = "it";
const grid = document.getElementById("grid");
const themeSelect = document.getElementById("theme");
for (const [id, name] of THEMES) {
  const option = element("option", "", id + " \u00b7 " + name);
  option.value = id;
  themeSelect.append(option);
}
themeSelect.value = themeId;

function draw() {
  const deck = DATA.deck;
  const deckCopy = deck.locales[localeId] ?? deck.locales[deck.defaultLocale];
  const total = deck.cards.reduce((sum, entry) => sum + entry.count, 0);
  document.documentElement.lang = localeId;
  document.getElementById("eyebrow").textContent =
    LABELS[localeId].deck + " \u00b7 " + LABELS[localeId].cards(total) + " \u00b7 Rubyfront";
  document.getElementById("title").textContent = deckCopy.name;
  document.getElementById("lede").textContent = deckCopy.description;

  grid.replaceChildren();
  for (const entry of deck.cards) {
    const card = DATA.cards[entry.card];
    if (!card) continue;
    const cardCopy = localized(card, localeId);
    for (const face of card.faces) {
      const tile = element("div", "deck-tile");
      const holder = element("div", "deck-holder");
      holder.append(createFace(card, face, cardCopy, themeId));
      tile.append(holder, element("span", "deck-count", "\u00d7" + entry.count));
      grid.append(tile);
    }
  }
  applyTheme(themeId);
}
function applyTheme(next) {
  themeId = next;
  for (const visual of grid.querySelectorAll(".card")) {
    visual.classList.remove(...THEMES.map(([id]) => id), "light-theme");
    visual.classList.add(themeId);
    if (LIGHT_THEMES.has(themeId)) visual.classList.add("light-theme");
  }
  themeSelect.value = themeId;
}
themeSelect.addEventListener("change", event => applyTheme(event.target.value));
document.getElementById("lang").addEventListener("change", event => {
  localeId = event.target.value; draw();
});
draw();
