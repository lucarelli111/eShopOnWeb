#!/usr/bin/env node
/**
 * Automated traffic simulator for eShopOnWeb
 * Generates continuous realistic user traffic for Datadog monitoring
 */

const { chromium } = require('playwright');
const winston = require('winston');

// Configure Winston with JSON logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console()
  ]
});

// Configuration
const APP_URL = process.env.APP_URL;
const ITERATIONS_PER_CYCLE = 20;
const DELAY_BETWEEN_CYCLES = 15000; 

if (!APP_URL) {
  logger.error('APP_URL environment variable is required');
  process.exit(1);
}

logger.info('eShopOnWeb Traffic Simulator started', {
  target: APP_URL,
  iterationsPerCycle: ITERATIONS_PER_CYCLE,
  delayBetweenCycles: DELAY_BETWEEN_CYCLES / 1000
});

// Random delay to simulate human behavior
const randomDelay = (min = 500, max = 2000) => 
  new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1)) + min));

// User scenarios
const scenarios = [
  {
    name: 'Browse and Add to Cart',
    weight: 30,
    async execute(page) {
      await page.goto(APP_URL);
      await randomDelay(1000, 2000);

      // Browse catalog
      const brandFilter = page.locator('select.esh-catalog-filter').first();
      if (await brandFilter.count() > 0) {
        const optionCount = await brandFilter.locator('option').count();
        if (optionCount > 1) {
          await brandFilter.selectOption({ index: 1 });
          await page.locator('input.esh-catalog-send[type="image"]').click();
          await randomDelay(1000, 1500);
        }
      }

      // Add to cart directly from catalog
      const addToBasketButtons = page.locator('input.esh-catalog-button[type="submit"][value="[ ADD TO BASKET ]"]');
      const count = await addToBasketButtons.count();
      if (count > 0) {
        await addToBasketButtons.nth(Math.floor(Math.random() * count)).click();
        await randomDelay(500, 1000);
      }

      // View basket
      await page.goto(`${APP_URL}/basket`);
      await randomDelay(1000, 1500);
    }
  },
  {
    name: 'Full Checkout Flow (Login → Add to Cart → Checkout)',
    weight: 40, 
    async execute(page) {
      // 1. Login
      await page.goto(`${APP_URL}/Identity/Account/Login`);
      await randomDelay(200, 400); // Reduced from 1000-1500
      
      // Fill in login credentials
      await page.fill('input[name="Input.Email"]', 'demouser@microsoft.com');
      await randomDelay(100, 200); // Reduced from 300-500
      await page.fill('input[name="Input.Password"]', 'Pass@word1');
      await randomDelay(100, 200); // Reduced from 300-500
      
      await page.locator('button[type="submit"]:has-text("Log in")').click();
      await randomDelay(500, 800); // Reduced from 1500-2000

      // 2. Browse and add to cart
      await page.goto(APP_URL);
      await randomDelay(300, 500);  // Reduced from 1500-2500

      // Wait for products to load
      try {
        await page.waitForSelector('input.esh-catalog-button[type="submit"]', { timeout: 3000 }); // Reduced from 5000
      } catch (e) {
        logger.warn('Products not loaded after 3 seconds', { url: page.url() });
      }

      // Check how many products are available
      let addToBasketButtons = page.locator('input.esh-catalog-button[type="submit"][value="[ ADD TO BASKET ]"]');
      let count = await addToBasketButtons.count();
      logger.info('Product count on home page', { count, url: page.url() });
      
      if (count > 0) {
        // Add only 1 item to cart (faster)
        const itemsToAdd = 1; // Changed from 2-3 items
        logger.info('Adding items to cart', { itemsToAdd });
        
        for (let i = 0; i < itemsToAdd; i++) {
          await page.goto(APP_URL);
          await randomDelay(200, 300); // Reduced from 500-800
          
          // Re-query the products after navigation
          addToBasketButtons = page.locator('input.esh-catalog-button[type="submit"][value="[ ADD TO BASKET ]"]');
          count = await addToBasketButtons.count();
          
          if (count > 0) {
            await addToBasketButtons.nth(Math.floor(Math.random() * count)).click();
            await randomDelay(200, 300); // Reduced from 500-800
            logger.info('Item added to basket', { itemNumber: i + 1 });
          } else {
            logger.warn('No products available on home page', { itemNumber: i + 1 });
          }
        }
      } else {
        logger.warn('No products found to add to cart');
      }

      // 3. View basket
      await page.goto(`${APP_URL}/basket`);
      await randomDelay(300, 500); // Reduced from 1000-1500
      
      // Verify basket has items
      const basketItems = page.locator('.esh-basket-items article');
      const itemCount = await basketItems.count();
      logger.info('Basket item count', { itemCount });

      // 4. Checkout
      const checkoutBtn = page.locator('a.esh-basket-checkout:has-text("Checkout")');
      if (await checkoutBtn.count() > 0) {
        await checkoutBtn.click();
        await randomDelay(500, 800); // Reduced from 1500-2000
        
        // 5. Complete the purchase (Pay Now)
        const payNowBtn = page.locator('input[type="submit"][value="[ Pay Now ]"]');
        if (await payNowBtn.count() > 0) {
          await payNowBtn.click();
          await randomDelay(500, 800); // Reduced from 1000-1500
          
          // Should be redirected to success page
          logger.info('Checkout completed successfully', { url: page.url() });
        } else {
          logger.warn('Pay Now button not found - basket might be empty');
        }
      } else {
        logger.warn('Checkout button not found - basket might be empty');
      }

      // 6. Logout - Submit the logout form
      // The logout form is already present in the page header, we just need to submit it
      await page.evaluate(() => {
        const logoutForm = document.getElementById('logoutForm');
        if (logoutForm) {
          logoutForm.submit();
        }
      });
      await randomDelay(500, 800);
    }
  },
  {
    name: 'Quick Browse',
    weight: 20,
    async execute(page) {
      await page.goto(APP_URL);
      await randomDelay(1000, 2000);

      // Browse catalog by changing filters a few times
      const brandFilter = page.locator('select.esh-catalog-filter').first();
      const typeFilter = page.locator('select.esh-catalog-filter').nth(1);
      
      if (await brandFilter.count() > 0) {
        const brandOptions = await brandFilter.locator('option').count();
        const typeOptions = await typeFilter.count() > 0 ? await typeFilter.locator('option').count() : 0;
        
        for (let i = 0; i < 3; i++) {
          // Randomly select a filter
          if (Math.random() > 0.5 && brandOptions > 1) {
            await brandFilter.selectOption({ index: Math.floor(Math.random() * brandOptions) });
          } else if (typeOptions > 1) {
            await typeFilter.selectOption({ index: Math.floor(Math.random() * typeOptions) });
          }
          
          await page.locator('input.esh-catalog-send[type="image"]').click();
          await randomDelay(800, 1500);
        }
      }
    }
  },
  {
    name: 'API Health Check (Web → PublicApi)',
    weight: 15,
    async execute(page) {
      // This triggers a distributed trace: Web calls PublicApi
      await page.goto(`${APP_URL}/api_health_check`);
      await randomDelay(500, 1000);
    }
  },
  {
    name: 'Direct API Call (PublicApi)',
    weight: 10,
    async execute(page) {
      // Direct call to PublicApi service
      // Handle both Docker (eshopwebmvc) and Azure (app-web-xxx) URLs
      let apiUrl = APP_URL.replace('eshopwebmvc', 'eshoppublicapi');  // Docker
      apiUrl = apiUrl.replace('app-web-', 'app-api-');  // Azure
      await page.goto(`${apiUrl}/api/catalog-items`);
      await randomDelay(500, 1000);
    }
  }
];

// Select scenario based on weights
function selectScenario() {
  const totalWeight = scenarios.reduce((sum, s) => sum + s.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const scenario of scenarios) {
    random -= scenario.weight;
    if (random <= 0) return scenario;
  }
  
  return scenarios[0];
}

async function runSimulation() {
  const startTime = Date.now();
  let successCount = 0;
  let errorCount = 0;

  const browser = await chromium.launch({ headless: true });

  for (let i = 1; i <= ITERATIONS_PER_CYCLE; i++) {
    const scenario = selectScenario();
    logger.info('Running scenario', {
      iteration: i,
      total: ITERATIONS_PER_CYCLE,
      scenario: scenario.name
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 }
    });
    const page = await context.newPage();

    try {
      await scenario.execute(page);
      logger.info('Scenario completed successfully', {
        scenario: scenario.name,
        iteration: i
      });
      successCount++;
    } catch (error) {
      logger.error('Scenario failed', {
        scenario: scenario.name,
        iteration: i,
        error: error.message
      });
      errorCount++;
    } finally {
      await context.close();
      await randomDelay(2000, 4000); // Delay between sessions
    }
  }

  await browser.close();

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  logger.info('Cycle summary', {
    successful: successCount,
    errors: errorCount,
    total: ITERATIONS_PER_CYCLE,
    durationSeconds: elapsed
  });
}

// Main loop - run forever
async function main() {
  let cycleCount = 0;
  
  while (true) {
    cycleCount++;
    logger.info('Starting cycle', {
      cycle: cycleCount,
      timestamp: new Date().toISOString()
    });
    
    try {
      await runSimulation();
    } catch (error) {
      logger.error('Error in simulation cycle', {
        cycle: cycleCount,
        error: error.message
      });
    }
    
    logger.info('Waiting before next cycle', {
      delaySeconds: DELAY_BETWEEN_CYCLES / 1000
    });
    await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CYCLES));
  }
}

// Run
main().catch(error => {
  logger.error('Fatal error', {
    error: error.message,
    stack: error.stack
  });
  process.exit(1);
});

