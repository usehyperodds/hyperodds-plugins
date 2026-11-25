import { currentFeed, edge, fair, market, price } from "./functions.js";
import { render } from "./page.js";

if (typeof globalThis.CustomFunctions?.associate === "function") {
  CustomFunctions.associate("PRICE", price);
  CustomFunctions.associate("FAIR", fair);
  CustomFunctions.associate("EDGE", edge);
  CustomFunctions.associate("MARKET", market);
}

const show = (host) => render(host === "Excel", currentFeed());
if (typeof Office === "undefined") document.addEventListener("DOMContentLoaded", () => show(null));
else Office.onReady((info) => show(info.host));
