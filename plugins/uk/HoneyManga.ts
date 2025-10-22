import { Plugin, PluginID } from '@typings/plugin';
import { FilterTypes, Filter } from '@typings/filter';
import { Novel, NovelItem } from '@typings/novel';
import { Chapter, ChapterItem } from '@typings/chapter';
import { fetchApi, fetchFile } from '@utils/fetch';
import * as cheerio from 'cheerio'; // Інструмент для парсингу HTML

export const id: PluginID = 'honeymanga'; // Унікальний ID
export const name = 'Honey Manga'; // Назва в додатку
export const site = 'https://honey-manga.com.ua'; // Базовий URL
export const version = '1.0.0';
export const icon = 'src/uk/honeymanga/icon.png'; // Шлях до іконки

const pluginId = id;

class HoneyManga implements Plugin {
  // Функція для отримання популярних новел (зі сторінки "comics")
  async popularNovels(
    page: number,
    options: { filters?: Record<string, string[]> },
  ): Promise<NovelItem[]> {
    const url = `${site}/comics?page=${page}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = cheerio.load(body);

    const novels: NovelItem[] = [];
    $('a.flex.flex-col').each((i, el) => {
      const novelItem: NovelItem = {
        name: $(el).find('p.text-sm').text().trim(),
        path: $(el).attr('href') || '',
        cover: $(el).find('img').attr('src'),
      };
      novels.push(novelItem);
    });
    return novels;
  }

  async searchNovels(searchTerm: string, page: number): Promise<NovelItem[]> {
    return [];
  }

  async parseNovelAndChapters(novelPath: string): Promise<Novel> {
    const url = `${site}${novelPath}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = cheerio.load(body);

    // Унікальні селектори для Info
    const infoRoot = $('.md:flex-1.max-md:w-full.max-md:mt-6');
    const name =
      infoRoot.find('p.font-bold').first().text().trim() ||
      $('p.font-bold').first().text().trim();
    const summary =
      $('.MuiTabPanel-root .flex-1 > p.mt-4').first().text().trim() ||
      $('p.mt-4').first().text().trim();
    const cover = $('.relative.rounded-[4px] img').attr('src');

    const novel: Novel = {
      path: novelPath,
      name,
      cover,
      summary,
      author: '',
      status: '',
      chapters: [],
    };

    // Парсер списку розділів (глав)
    $('a.flex.items-start.justify-between.py-4.border-b').each((i, el) => {
      const path = $(el).attr('href') || '';
      // Увага. p для назви можна уточнити:
      const name = $(el).find('p.font-medium.text-sm').text().trim();
      // Для дати вибираємо .mt-3 span
      const releaseTime = $(el).find('div.mt-3 span').first().text().trim();
      if (name && path) {
        novel.chapters?.push({ name, path, releaseTime });
      }
    });
    if (novel.chapters.length > 1) {
      novel.chapters.reverse();
    }
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = `${site}${chapterPath}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = cheerio.load(body);
    const chapterBlocks = $('div.py-[6px]');

    if (!chapterBlocks.length) {
      // Додаю додаткову перевірку на наявність зображень (манґи)
      const images = $('img');
      if (images.length > 5) {
        throw new Error(
          'Помилка: Цей розділ містить зображення (манґу), а не текст.',
        );
      }
      throw new Error('Не вдалося завантажити розділ: текст відсутній.');
    }

    const content = chapterBlocks
      .map((_, el) => $(el).html())
      .get()
      .join('<br>');
    return content;
  }

  async fetchImage(url: string): Promise<string | undefined> {
    // Повертає повний шлях, якщо у src залишився / на початку
    if (url && url.startsWith('/')) {
      return fetchFile(site + url);
    }
    return fetchFile(url);
  }

  get filters(): Filter[] {
    return [];
  }
}

export default new HoneyManga();
