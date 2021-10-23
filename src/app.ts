import { ElementHandle, launch, Page } from 'puppeteer';
import { stringify } from 'csv/lib/sync';
import * as fs from 'fs';

interface Store {
    name: string
    address: string;
    genre: string
}

/**
 * 現在のページ番号を取得する
 *
 * @param page Pageオブジェクト
 */
const pickCurrentPageNumber = async (page: Page): Promise<number> => {
  return await page.$eval('#search_result_pagination li.selected a', item => {
    return Number(item.textContent);
  });
};

/**
 * 次のページへ遷移する
 * @param page Pageオブジェクト
 */
const clickNextPageButton = async (page: Page): Promise<void> => {
  console.log('次のページへ遷移');
  await page.click('#search_result_pagination li.next a');
};

/**
 * 次のページへ遷移するボタンがあるかを確認する
 * @param page Pageオブジェクト
 */
const hasNextPageButton = async (page: Page): Promise<boolean> => {
  return await page.$('#search_result_pagination li.next').then(el => !!el);
};

/**
 * 加盟店概要をStoreオブジェクトに変換する
 *
 * @param detailEl 加盟店概要のElementHandle
 * @param genre 加盟店のジャンル
 */
const detailToStoreObj = async (detailEl: ElementHandle, genre: string): Promise<Store> => {
  const name = await detailEl.$eval('h4', h4 => h4.textContent);
  const address = await detailEl.$eval('.search_result_lists_address', addr => addr.textContent);

  return { name, address, genre };
};

/**
 * 検索結果から加盟店を抽出
 *
 * @param page
 * @param genre
 */
const pickStores = async (page: Page, genre: string): Promise<Store[]> => {
  console.log('検索結果から加盟店を抽出');
  const stores: Store[] = [];

  let pageNumber = await pickCurrentPageNumber(page);
  let hasNextPage = true;
  while (hasNextPage) {
    pageNumber = await pickCurrentPageNumber(page);
    console.log(`現在のページ番号: ${pageNumber}`);

    console.log('加盟店情報を抽出');
    const details = await page.$$('#search_result_lists .search_result_lists_details');
    const pickedStores = await Promise.all<Store>(details.map(detail => detailToStoreObj(detail, genre)));
    stores.push(...pickedStores);

    hasNextPage = await hasNextPageButton(page);

    if (hasNextPage) {
      await Promise.all([
        clickNextPageButton(page),
        page.waitForSelector('#search_result_lists', { visible: true }),
      ]);
      await page.waitForTimeout(3000);
    }
  }

  return stores;
};

/**
 * Storeの配列をCSVに変換する
 *
 * @param stores 加盟店の情報が入ったStoreオブジェクトの配列
 * @param prefName 加盟店の県名
 * @param genreName 加盟店のジャンル名
 */
const createCSVFile = (stores: Store[], prefName: string, genreName: string) => {
  const csvData = stringify(stores, { header: true });
  const path = `./dist/${prefName}-${genreName}.csv`;
  console.log(`${path} を作成`);
  fs.writeFileSync(path, csvData);
};

/**
 * 都道府県名からCSVファイルを作成
 *
 * @param page ブラウザのPageオブジェクト
 * @param pref 都道府県のElementHandle
 */
const createMaps = async (page: Page, pref: ElementHandle): Promise<void> => {
  const prefStores: Store[] = [];
  const prefName = await pref.$eval('input', input => input.getAttribute('data-label'));
  console.log(`${prefName}の加盟店マップ作成を開始`);

  await pref.$('a[href="javascript:;"]').then(el => el.click());
  await page.waitForTimeout(3000);

  const genres = await page.$$('#genre_list ul li');
  for (const genre of genres) {
    const genreName = await genre.$eval('input', input => input.getAttribute('data-label'));
    console.log(`ジャンル: ${genreName}`);
    const genreSelect = await genre.$('a');
    await genreSelect.click();
    await page.waitForTimeout(3000);

    console.log('この条件で検索をクリック');
    await Promise.all([
      page.waitForSelector('#search_result_lists', { visible: true }),
      page.click('#search_submit_basic'),
    ]);
    await page.waitForTimeout(3000);

    console.log('表示件数を100件に変更');
    await page.select('select[name="posts_per_page"]', '100');
    await page.waitForTimeout(3000);

    const searchResult = await page.$eval('#search_result_text', el => el.textContent);
    console.log(searchResult);

    const stores = await pickStores(page, genreName);
    prefStores.push(...stores);

    createCSVFile(stores, prefName, genreName);

    await genreSelect.click();
  }

  createCSVFile(prefStores, prefName, 'all');

  console.log('Next pref');
  await page.$('.area_city_list .common_search_nav a').then(el => el.click());
};

const main = async (): Promise<void> => {
  console.log('ブラウザを起動');
  const browser = await launch({ headless: false });

  console.log('ページを作成');
  const page = await browser.newPage();

  console.log('加盟店検索を開く');
  await page.goto('https://www.jfcard.co.jp/shopinfo/use.php');

  const allPrefs = await page.$$('.area_list.area_pref_list ul li ul li');
  const selectedPrefs = [17].map(n => allPrefs[n]);

  for (const pref of selectedPrefs) {
    await createMaps(page, pref);
  }

  await browser.close();
};

console.log(main());
