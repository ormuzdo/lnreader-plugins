import { CheerioAPI, load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';

class HoneyManga implements Plugin.PluginBase {
  id = 'honeymanga';
  name = 'Honey Manga';
  icon = 'src/ukrainian/honeymanga/icon.png';
  site = 'https://honey-manga.com.ua';
  version = '1.0.0';
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
    return [];
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = `${this.site}${novelPath}`;
    const result = await fetchApi(url);
    const body = await result.text();
    const $ = parseHTML(body);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $('p.font-bold').text().trim(),
      cover: $('.relative.rounded-[4px] img').attr('src'),
      summary: $('p.mt-4').text().trim(),
      author: '',
    };

    const chapters: Plugin.ChapterItem[] = [];
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
