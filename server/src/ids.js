const crypto = require("crypto");

function digits(length) {
  let out = "";
  while (out.length < length) {
    out += crypto.randomInt(0, 1_000_000_000).toString().padStart(9, "0");
  }
  return out.slice(0, length);
}

function maskedCard() {
  return `**** **** **** ${digits(4)}`;
}

module.exports = { digits, maskedCard };
