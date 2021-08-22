const puppeteer = require("puppeteer");
const fs = require("fs").promises;

// Cache files:
const LIST_FILE_NAME = "card_urls.json";
const DETAILS_FILE_NAME = "card_details.json";

// Set to true to re-scrap card list.
// The card details equivalent of this is a method: updateCardDetails
const SHOULD_UPDATE_LIST = false;

(async () => {
	const browser = await puppeteer.launch();
	const page = await browser.newPage();
	// You may save the card list here and process it in any way.
	await getCardDetailList(page);
	await browser.close();
})();

/**
 * Scrap the card list if SHOULD_UPDATE_LIST is true or the cache file (LIST_FILE_NAME) does not exist.
 */
async function updateCardList(page) {
	if (!SHOULD_UPDATE_LIST) {
		console.log(`Reading card list from file ${LIST_FILE_NAME}...`);
		try {
			const fileContent = await fs.readFile(LIST_FILE_NAME, "utf8");
			return JSON.parse(fileContent);
		} catch (error) {
			// This is fine, we will scrap instead.
			console.error(`Got an error trying to read file ${LIST_FILE_NAME}: ${error.message}`);
		}
	}

	console.log("Extracting card list...");
	await page.goto("https://yugipedia.com/wiki/Category:Duel_Monsters_cards");
	const cardList = await extractWikiCategoryPageList(page);
	console.log("Saving card list cache...");
	try {
		await fs.writeFile(LIST_FILE_NAME, JSON.stringify(cardList));
		console.log("Output file:", LIST_FILE_NAME);
	} catch (error) {
		// This is not fine -- unrecoverable.
		console.error(`Got an error trying to write to file ${LIST_FILE_NAME}: ${error.message}`);
		throw error;
	}
	return cardList;
}

async function extractWikiCategoryPageList(page) {
	const list = [];
	for (; ;) {
		let linkList = await extractWikiCategoryPageLinkList(page);
		list.push(...linkList);
		const nextButton = await page.evaluate(() => {
			return Promise.resolve(document.evaluate("//a[contains(text(), 'next page')]", document.body).iterateNext()?.href);
		});
		if (!nextButton) {
			break;
		}
		console.log(`Opening next set... ${nextButton}`);
		await page.goto(nextButton);
	}
	return list;
}

async function extractWikiCategoryPageLinkList(page) {
	return await page.evaluate(() => {
		const categoryElement = document.getElementById("mw-pages");
		const linkList = categoryElement.querySelectorAll("li a");
		return Promise.resolve(Array.from(linkList).map((anchor) => anchor.href));
	});
}

async function extractAllTables(page) {
	return await page.evaluate(() => {
		const result = Array.from(document.getElementsByTagName("table")).map((table) => {
			const header = Array.from(table.querySelectorAll("tr th")).map((column) => column.innerText);
			const rows = table.querySelectorAll("tr");
			const data = Array.from(rows).map((row) => {
				const columns = row.querySelectorAll("td");
				return Array.from(columns, column => column.innerText);
			});
			return {
				header,
				data,
			}
		});
		return Promise.resolve(result);
	});
}

async function extractVerticalTableHeaderContent(page, name) {
	return await page.evaluate((name) => {
		const result = Array
			.from(document.getElementsByTagName("table"))
			.map((table) => {
				return Array
					.from(table.querySelectorAll("tr"))
					.map((row) => {
						const header = row.querySelector("th");
						if (header && header.innerText == name) {
							const columnList = Array.from(row.querySelectorAll("td"));
							if (columnList.length == 1) {
								return columnList[0].innerText.trim();
							}
						}
						return null;
					})
					.find((x) => x);
			})
			.find((x) => x);
		return Promise.resolve(result);
	}, name);
}

/**
 * Scrap the card details if shouldUpdateCardDetails is true or the given details have not been scrapped yet, otherwise use the file DETAILS_FILE_NAME.
 */
async function updateCardDetails(page, cardList) {
	const cardScrapSet = new Set(cardList);

	const detailsList = [];
	console.log(`Reading card details from file ${DETAILS_FILE_NAME}...`);
	try {
		const fileContent = await fs.readFile(DETAILS_FILE_NAME, "utf8");
		const cardDetailsCacheList = JSON.parse(fileContent);
		cardDetailsCacheList.map((details) => {
			let shouldUpdate = true;
			try {
				shouldUpdate = shouldUpdateCardDetails(details);
			} catch (e) {
				console.error(`Caught exception trying to determine update criteria: ${error.message}`);
			}
			if (!shouldUpdate) {
				cardScrapSet.delete(details.link);
				detailsList.push(details);
			}
		});
	} catch (error) {
		// This is fine, we will scrap instead.
		console.error(`Got an error trying to read file ${DETAILS_FILE_NAME}: ${error.message}`);
	}

	if (cardScrapSet.size == 0) {
		console.log(`Using cache: ${detailsList.length} (skipping cache write since it is unchanged)`);
		return detailsList;
	}

	console.log(`Skipped ${detailsList.length}, scrapping ${cardScrapSet.size}...`);
	try {
		for (link of cardScrapSet) {
			const details = await extractCardDetails(page, link);
			detailsList.push(details);
		}
	} catch (error) {
		console.error(`Caught error trying to extract card details: ${error.message}`);
	}

	detailsList.sort((left, right) => {
		var nameLeft = left.name;
		var nameRight = right.name;
		if (nameLeft < nameRight) {
			return -1;
		} else if (nameLeft > nameRight) {
			return 1;
		}
		return 0;
	})

	console.log(`Saving ${detailsList.length} items to card details cache...`);
	try {
		await fs.writeFile(DETAILS_FILE_NAME, JSON.stringify(detailsList));
		console.log("Output file:", DETAILS_FILE_NAME);
	} catch (error) {
		// This is not fine -- unrecoverable.
		console.error(`Got an error trying to write to file ${DETAILS_FILE_NAME}: ${error.message}`);
		throw error;
	}

	return detailsList;
}

/**
 * Takes in card details from a cache and returns true if this card should be re-scrapped.
 */
function shouldUpdateCardDetails(details) {
	// Return true to force re-scrap.
	// You can add logic, e.g. if you add a new field to be scrapped and if it doesn't exist in cache, then re-scrap.
	return false;
}

async function extractCardDetails(page, link) {
	console.log(`Extracting ${link}...`);
	await page.goto(link);
	const name = await page.evaluate(() => {
		return Promise.resolve(document.getElementsByClassName("heading")[0].innerText);
	})
	const tableList = await extractAllTables(page);
	let release = null;
	tableList
		.map((table) => {
			const releaseHeader = table.header.find((header) => header.includes("Release"));
			if (releaseHeader == null) {
				return [table, -1];
			}
			return [table, table.header.indexOf(releaseHeader)];
		})
		.filter(([_table, releaseIndex]) => releaseIndex != -1)
		.map(([table, releaseIndex]) => {
			table.data.forEach((row) => {
				const rowRelease = row[releaseIndex];
				if (rowRelease && (release === null || rowRelease < release)) {
					release = rowRelease;
				}
			});
		});

	const category = await extractVerticalTableHeaderContent(page, "Card type");
	const attribute = await extractVerticalTableHeaderContent(page, "Attribute");
	const types = (await extractVerticalTableHeaderContent(page, "Types"))?.split("/").map((x) => x.trim());
	const monster_type = types?.[0];
	types?.shift();
	const monster_card_types = types;

	const level = await extractVerticalTableHeaderContent(page, "Level");
	const rank = await extractVerticalTableHeaderContent(page, "Rank");
	const attackDefensePair = (await extractVerticalTableHeaderContent(page, "ATK / DEF"))?.split("/").map((x) => x.trim());
	const attackLinkPair = (await extractVerticalTableHeaderContent(page, "ATK / LINK"))?.split("/").map((x) => x.trim());
	const attack = attackDefensePair?.[0] || attackLinkPair?.[0];
	const defense = attackDefensePair?.[1];
	const link_rating = attackLinkPair?.[1];
	const link_arrows = await extractVerticalTableHeaderContent(page, "Link Arrows");
	const pendulum_scale = await extractVerticalTableHeaderContent(page, "Pendulum Scale");
	const password = await extractVerticalTableHeaderContent(page, "Password");
	const property = await extractVerticalTableHeaderContent(page, "Property");

	const description = await page.evaluate(() => {
		return document.getElementsByClassName("lore")[0].innerText;
	});

	return {
		name,
		link,
		description,
		category,
		attribute,
		monster_type,
		monster_card_types,
		level,
		rank,
		link_rating,
		link_arrows,
		pendulum_scale,
		attack,
		defense,
		password,
		release,
		property,
	};
}

async function getCardDetailList(page) {
	console.log("Starting...");
	const cardList = await updateCardList(page);
	console.log(`Found ${cardList.length} pages. Extracting...`);
	const detailsList = await updateCardDetails(page, cardList);
	console.log("Done");
	return detailsList;
}
