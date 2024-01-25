import { ElementHandle, launch, Page } from 'puppeteer';
import { stringify } from 'csv/lib/sync';
import * as fs from 'fs';

/**
 * 加盟店情報のオブジェクト
 */
interface Merchant {
  /**
   * 加盟店名
   */
  name: string

  /**
   * 加盟店の住所
   * 一部加盟店では住所をGoogle Mapsに反映できない可能性あり
   */
  address: string;

  /**
   * 加盟店のジャンル
   * ジャンル分けはジェフグルメカード公式サイトのジャンルをそのまま採用
   */
  genre: string
}

/**
 * 都道府県名を取得する
 *
 * @param pref 都道府県のElementHandle
 */
const getPrefecturesName = async (pref: ElementHandle): Promise<string> => {
  const prefName = await pref.$eval('input', input => input.getAttribute('data-label'));
  if (prefName === null) {
    throw new Error('都道府県名の取得に失敗しました。');
  }

  return prefName;
};

/**
 * 現在のページ番号を取得する
 *
 * @param page Pageオブジェクト
 */
const getNowPagination = async (page: Page): Promise<number> => {
  return await page.$eval('#search_result_pagination li.selected a', item => {
    return Number(item.textContent);
  });
};

/**
 * 検索結果を次のページへ遷移する
 *
 * @param page
 */
const searchResultNextPageToTransition = async (page: Page): Promise<void> => {
  console.log('次のページへ遷移');
  await Promise.all([
    page.click('#search_result_pagination li.next a'),
    page.waitForSelector('#search_result_lists', { visible: true }),
  ]);
  await page.waitForTimeout(3000);
};

/**
 * 全てのジャンルのElementHandleを返す
 *
 * @param page
 */
const getGenreElementHandles = async (page: Page): Promise<ElementHandle[]> => {
  return await page.$$('#genre_list ul li');
};

/**
 * ジャンルのElementHandleからジャンル名を取得する
 *
 * @param genreEl
 */
const getGenreName = async (genreEl: ElementHandle): Promise<string> => {
  const genreName = await genreEl.$eval('input', input => input.getAttribute('data-label'));
  if (genreName === null) {
    throw new Error('ジャンル名の取得に失敗しました。');
  }

  return genreName;
};

/**
 * 次のページへ遷移するボタンがあるかを確認する
 * @param page Pageオブジェクト
 */
const hasNextPageButton = async (page: Page): Promise<boolean> => {
  return await page.$('#search_result_pagination li.next').then(el => !!el);
};

/**
 * 加盟店概要をMerchantオブジェクトに変換する
 *
 * @param detailEl 加盟店概要のElementHandle
 * @param genre 加盟店のジャンル
 */
const convertDetailToMerchantObj = async (detailEl: ElementHandle, genre: string): Promise<Merchant> => {
  const name = await detailEl.$eval('h4', h4 => h4.textContent);
  if (name === null) {
    throw new Error('加盟店名の取得に失敗しました。');
  }
  const address = await detailEl.$eval('.search_result_lists_address', addr => addr.textContent);
  if (address === null) {
    throw new Error('住所の取得に失敗しました。');
  }

  return { name, address, genre };
};

/**
 * 検索結果から加盟店を抽出
 *
 * @param page
 * @param genre
 */
const getMerchantFromSearchResult = async (page: Page, genre: string): Promise<Merchant[]> => {
  console.log('検索結果から加盟店を抽出');
  const merchants: Merchant[] = [];

  let pageNumber = await getNowPagination(page);
  let hasNextPage = true;
  while (hasNextPage) {
    pageNumber = await getNowPagination(page);
    console.log(`現在のページ番号: ${pageNumber}`);

    console.log('加盟店情報を抽出');
    const details = await page.$$('#search_result_lists .search_result_lists_details');
    const pickedMerchants = await Promise.all<Merchant>(details.map(detail => convertDetailToMerchantObj(detail, genre)));
    merchants.push(...pickedMerchants);

    hasNextPage = await hasNextPageButton(page);

    if (hasNextPage) {
      await searchResultNextPageToTransition(page);
    }
  }

  return merchants;
};

/**
 * Merchantの配列をCSVに変換する
 *
 * @param merchants 加盟店の情報が入ったMerchantオブジェクトの配列
 * @param prefName 加盟店の県名
 * @param genreName 加盟店のジャンル名
 */
const saveMerchantsToCSVFile = (merchants: Merchant[], prefName: string, genreName: string) => {
  const csvData = stringify.default(merchants, { header: true });
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
  const prefMerchants: Merchant[] = [];
  const prefecturesName = await getPrefecturesName(pref);
  console.log(`${prefecturesName}の加盟店マップ作成を開始`);

  await pref.$('a[href="javascript:;"]')
    .then((el) => {
      if (el === null) {
        throw new Error('');
      }

      return el;
    })
    .then(el => el.click());
  await page.waitForTimeout(3000);

  const genreHandles = await getGenreElementHandles(page);
  for (const genreHandle of genreHandles) {
    const genreName = await getGenreName(genreHandle);
    console.log(`ジャンル: ${genreName}`);
    const genreSelect = await genreHandle.$('a');
    if (genreSelect === null) {
      throw new Error('ジャンル要素の取得に失敗しました。');
    }
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

    const searchResult = await page.$eval('#search_result_text', (el) => {
      if (el === null || el.textContent === null) {
        throw new Error('検索結果の取得に失敗。');
      }

      return el.textContent.trim();
    });
    console.log(`検索結果: ${searchResult}`);

    const merchants = await getMerchantFromSearchResult(page, genreName);
    prefMerchants.push(...merchants);

    saveMerchantsToCSVFile(merchants, prefecturesName, genreName);

    await genreSelect.click();
  }

  saveMerchantsToCSVFile(prefMerchants, prefecturesName, 'all');

  console.log('Next pref');
  const nextPrefLink = await page.$('.area_city_list .common_search_nav a');
  if (nextPrefLink === null) {
    throw new Error('次の都道府県のリンクの取得に失敗しました。');
  }
  await nextPrefLink.click();
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
