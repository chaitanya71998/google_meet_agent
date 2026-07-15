import { Page } from 'puppeteer';

let currentPage: Page | null = null;

export function setPage(page: Page) {
  currentPage = page;
}

export function getPage(): Page | null {
  return currentPage;
}
