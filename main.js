const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const argv = yargs(hideBin(process.argv)).argv;

const inputFile = argv.input;
const outputFile = argv.output;

if (!inputFile || !outputFile) {
  console.error(
    "Please provide input and output file paths using --input and --output flags."
  );
  process.exit(1);
}

const { chromium } = require("playwright");
const fs = require("fs");
const { stringify } = require("csv-stringify/sync");

// Helper function to add a random delay between 0.5 and 2 seconds
function delay() {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * 1500) + 500)
  );
}

// Read company names from the input file
let companyNames;
try {
  companyNames = fs
    .readFileSync(inputFile, "utf-8")
    .split("\n")
    .filter((name) => name.trim() !== "");
} catch (error) {
  console.error(`Error reading input file: ${error.message}`);
  process.exit(1);
}

// Array to store results
const results = [];

// Function to perform a DuckDuckGo search and extract links
async function performSearch(page, query) {
  console.log(`Performing search for: "${query}"`);

  await page.goto("https://html.duckduckgo.com/html");
  await delay(); // Wait for the page to load

  // Type the query into the search bar
  const searchInput = 'input[name="q"]';
  await page.fill(searchInput, ""); // Ensure input is cleared
  await page.type(searchInput, query, { delay: 50 }); // Type with delay
  await page.keyboard.press("Enter");
  await delay(); // Wait for search results to load

  // Wait for the search results to load
  await page.waitForSelector(".results");

  // Extract all links from the results, skipping ads
  const links = await page.$$eval(".results .result", (results) => {
    return results
      .map((result) => {
        const isAd = result.querySelector("button.badge--ad"); // Check for ad badge
        if (isAd) return null; // Skip ads

        const link = result.querySelector("a.result__url");
        if (link) {
          const url = link.href;
          const urlParams = new URLSearchParams(url);
          return urlParams.get("uddg") || url;
        }
        return null;
      })
      .filter((link) => link !== null); // Filter out null values
  });

  console.log(`Found ${links.length} links for query: "${query}"`);
  return links;
}

(async () => {
  // Step 1: Launch a new browser instance (without persistent context)
  const browser = await chromium.launch({
    headless: true, // Run in headless mode (set to false for debugging)
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Loop through each company name
  for (const companyName of companyNames) {
    try {
      console.log(`\nProcessing company: ${companyName}`);

      // Perform the initial search
      const initialLinks = await performSearch(page, companyName);

      // Ensure the first non-ad result is selected as the website URL
      const websiteUrl = initialLinks.length > 0 ? initialLinks[0] : null;
      console.log("Website URL:", websiteUrl);

      // Try to find the LinkedIn URL in the initial results
      let linkedinUrl = null;
      for (const link of initialLinks) {
        if (link.includes("linkedin.com/company")) {
          linkedinUrl = link;
          break; // Stop iterating once a LinkedIn URL is found
        }
      }

      // If LinkedIn URL is not found, perform a fallback search
      if (!linkedinUrl) {
        console.log(
          "LinkedIn URL not found in initial search. Performing fallback search..."
        );

        // Perform the fallback search
        const fallbackLinks = await performSearch(
          page,
          `${companyName} LinkedIn`
        );

        // Find the LinkedIn URL in the fallback search results
        for (const link of fallbackLinks) {
          if (link.includes("linkedin.com/company")) {
            linkedinUrl = link;
            break; // Stop iterating once a LinkedIn URL is found
          }
        }
      }

      console.log("LinkedIn URL:", linkedinUrl);

      // Store the data for this company
      results.push({
        name: companyName,
        website: websiteUrl,
        linkedin: linkedinUrl || null,
      });
    } catch (error) {
      console.error(`Error processing company ${companyName}:`, error);
      results.push({
        name: companyName,
        website: null,
        linkedin: null,
        error: error.message,
      });
    }
  }

  // Step 2: Convert results to CSV format
  const csvData = results.map((result, index) => ({
    "S Number": index + 1, // Add S Number starting from 1
    Name: result.name,
    Website: result.website,
    LinkedIn: result.linkedin,
    Error: result.error || "", // Include error column if applicable
  }));

  const csvString = stringify(csvData, { header: true }); // Convert to CSV string

  // Step 3: Save the results to a CSV file
  try {
    fs.writeFileSync(outputFile, csvString);
    console.log(`Results saved to ${outputFile}`);
  } catch (error) {
    console.error(`Error writing to output file: ${error.message}`);
  }

  // Step 4: Close the browser
  await context.close();
  await browser.close();
})();
