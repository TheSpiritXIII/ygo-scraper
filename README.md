# ygoscrap
This project scraps Yugipedia for card information using Puppeteer.

This project makes use of a card list cache file and a card detail cache file to avoid unnecessary scrapping. As such, you may edit `index.js` to control scrapping behavior:
1. `SHOULD_UPDATE_LIST` - flag to control whether to scrap the card list.
2. `shouldUpdateCardDetails` - method to control whether to re-scrap a cached card.

Today, this project scraps (see `extractCardDetails`):
- Name
- The Yugipedia link
- The first ever release
- Description
- Card Category
- Monster Attributes, types, level, attack and defense
- Spell & trap card type

All scrapped data is committed to this repository so that others can benefit from it without having to run this tool directly (see `card_details.json`).

PRs are welcome.
