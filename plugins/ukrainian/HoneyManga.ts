import { CheerioAPI, load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';

class HoneyManga implements Plugin.PluginBase {
  id = 'honeymanga';
  name = 'Honey Manga';
  icon = 'src/ukrainian/honeymanga/icon.png';
  site = 'https://honey-manga.com.ua';
  version = '1.0.2';
  async popularNovels(
    pageNo: number,
    {
      filters,
      showLatestNovels,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const url = `${this.site}/comics?page=${pageNo}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];

    $('a.flex.flex-col').each((i, el) => {
      const novelItem: Plugin.NovelItem = {
        name: $(el).find('p.text-sm').text().trim(),
        path: $(el).attr('href') || '',
        cover: $(el).find('img').attr('src'),
      };
      novels.push(novelItem);
    });

    return novels;
  }

  async searchNovels(searchTerm: string): Promise<Plugin.NovelItem[]> {
    const url = `${this.site}/search?query=${encodeURIComponent(searchTerm)}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];

    $('a.flex.flex-col').each((i, el) => {
      const novelItem: Plugin.NovelItem = {
        name: $(el).find('p.text-sm').text().trim(),
        path: $(el).attr('href') || '',
        cover: $(el).find('img').attr('src'),
      };
      if (novelItem.name && novelItem.path) {
        novels.push(novelItem);
      }
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = `${this.site}${novelPath}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = parseHTML(body);

    const infoRoot = $('.md\\:flex-1.max-md\\:w-full.max-md\\:mt-6');
    const name =
      infoRoot.find('p.font-bold').first().text().trim() ||
      $('p.font-bold').first().text().trim();
    const summary =
      $('.MuiTabPanel-root .flex-1 > p.mt-4').first().text().trim() ||
      $('p.mt-4').first().text().trim();
    const cover = $('.relative.rounded-[4px] img').attr('src');

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name,
      cover,
      summary,
      author: '',
    };

    const chapters: Plugin.ChapterItem[] = [];

    $('a.flex.items-start.justify-between.py-4.border-b').each((i, el) => {
      const path = $(el).attr('href') || '';
      const chapterName = $(el).find('p.font-medium.text-sm').text().trim();
      const releaseTime = $(el).find('div.mt-3 span').first().text().trim();
      if (chapterName && path) {
        chapters.push({
          name: chapterName,
          path,
          releaseTime,
        });
      }
    });

    if (chapters.length > 1) {
      chapters.reverse();
    }

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = `${this.site}${chapterPath}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = parseHTML(body);

    const chapterBlocks = $('div.py-\\[6px\\]');

    if (!chapterBlocks.length) {
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

  filters = {} satisfies Filters;
}

export default new HoneyManga();
