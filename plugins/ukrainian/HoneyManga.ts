import { fetchApi, fetchText } from '@libs/fetch';
import { load as loadCheerio } from 'cheerio';
import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';

class HoneyManga implements Plugin.PluginBase {
  id = 'honeymanga';
  name = 'Honey Manga';
  icon = 'src/ukrainian/honeymanga/icon.png';
  site = 'https://honey-manga.com.ua';
  apiUrl = 'https://data.api.honey-manga.com.ua';
  version = '2.1.0';

  async popularNovels(
    pageNo: number,
    {
      filters,
      showLatestNovels,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const url = `${this.apiUrl}/v2/manga/cursor-list`;

    const body = {
      page: pageNo,
      pageSize: 30,
      sort: {
        sortBy: 'lastUpdated',
        sortOrder: 'DESC',
      },
      filters: [
        {
          filterBy: 'type',
          filterOperator: 'EQUAL',
          filterValue: ['Новела'],
        },
        {
          filterBy: 'adult',
          filterValue: ['18+'],
          filterOperator: 'NOT_IN',
        },
      ],
    };

    const result = await fetchApi(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await result.json();
    const novels: Plugin.NovelItem[] = [];

    if (data.data && Array.isArray(data.data)) {
      data.data.forEach((item: any) => {
        novels.push({
          name: item.title,
          path: `/book/${item.id}`,
          cover: item.posterUrl
            ? `https://img.honey-manga.com.ua/cover/${item.posterUrl}`
            : undefined,
        });
      });
    }

    return novels;
  }

  async searchNovels(searchTerm: string): Promise<Plugin.NovelItem[]> {
    const url = `${this.apiUrl}/v2/manga/cursor-list`;

    const body = {
      page: 1,
      pageSize: 30,
      sort: {
        sortBy: 'lastUpdated',
        sortOrder: 'DESC',
      },
      filters: [
        {
          filterBy: 'type',
          filterOperator: 'EQUAL',
          filterValue: ['Новела'],
        },
        {
          filterBy: 'adult',
          filterValue: ['18+'],
          filterOperator: 'NOT_IN',
        },
        {
          filterBy: 'title',
          filterOperator: 'CONTAINS',
          filterValue: [searchTerm],
        },
      ],
    };

    const result = await fetchApi(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await result.json();
    const novels: Plugin.NovelItem[] = [];

    if (data.data && Array.isArray(data.data)) {
      data.data.forEach((item: any) => {
        novels.push({
          name: item.title,
          path: `/book/${item.id}`,
          cover: item.posterUrl
            ? `https://img.honey-manga.com.ua/cover/${item.posterUrl}`
            : undefined,
        });
      });
    }

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    // novelPath має формат /book/{id}
    const novelId = novelPath.replace('/book/', '');
    const url = `${this.apiUrl}/manga/${novelId}`;

    const result = await fetchApi(url);
    const data = await result.json();

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: data.title || '',
      cover: data.posterUrl
        ? `https://img.honey-manga.com.ua/cover/${data.posterUrl}`
        : undefined,
      summary: data.description || '',
      author: data.authors?.join(', ') || '',
      genres: data.genres?.join(', '),
      status: data.translationStatus || '',
    };

    // Завантажуємо розділи
    const chapters: Plugin.ChapterItem[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const chaptersUrl = `${this.apiUrl}/v2/chapter/cursor-list`;
      const chaptersBody = {
        page,
        pageSize: 100,
        mangaId: novelId,
        sortOrder: 'ASC',
      };

      const chaptersResult = await fetchApi(chaptersUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chaptersBody),
      });

      const chaptersData = await chaptersResult.json();

      if (chaptersData.data && Array.isArray(chaptersData.data)) {
        chaptersData.data.forEach((chapter: any) => {
          const chapterName = `Том ${chapter.volume} Розділ ${chapter.chapterNum}${chapter.subChapterNum ? `.${chapter.subChapterNum}` : ''}: ${chapter.title}`;

          chapters.push({
            name: chapterName,
            path: `/read/${novelId}/${chapter.id}`,
            releaseTime: chapter.lastUpdated,
          });
        });

        // Перевірка чи є ще сторінки
        hasMore =
          chaptersData.cursorNext &&
          chaptersData.data.length === chaptersBody.pageSize;
        page++;
      } else {
        hasMore = false;
      }
    }

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    // chapterPath має формат /read/{novelId}/{chapterId}
    const url = `${this.site}${chapterPath}`;

    console.log('[HoneyManga Debug] Fetching chapter from:', url);

    // Спробуємо API спочатку
    const pathParts = chapterPath.split('/');
    const novelId = pathParts[2];
    const chapterId = pathParts[3];

    const apiUrl = `${this.apiUrl}/v2/chapter/frames/${novelId}/${chapterId}`;
    console.log('[HoneyManga Debug] Trying API:', apiUrl);

    try {
      const result = await fetchApi(apiUrl);
      const data = await result.json();

      if (data && Array.isArray(data) && data.length > 0) {
        console.log('[HoneyManga Debug] API success! Frames:', data.length);
        let chapterContent = '';

        data.forEach((frame: any) => {
          if (frame.text) {
            chapterContent += `<p>${frame.text}</p>\n`;
          }
          if (frame.imageUrl) {
            chapterContent += `<img src="${frame.imageUrl}" />\n`;
          }
        });

        if (chapterContent) {
          return chapterContent;
        }
      }
    } catch (error) {
      console.log('[HoneyManga Debug] API failed, trying HTML parsing');
    }

    // Якщо API не спрацював, парсимо HTML
    const html = await fetchText(url);
    const $ = loadCheerio(html);

    console.log('[HoneyManga Debug] HTML length:', html.length);

    // Шукаємо текстові блоки
    let chapterContent = '';

    // Спроба 1: div з класом py-[6px]
    $('div[class*="py-[6px]"]').each((i, elem) => {
      const text = $(elem).text().trim();
      if (text) {
        chapterContent += `<p>${text}</p>\n`;
      }
    });

    // Спроба 2: Пошук в Next.js data
    if (!chapterContent) {
      const scriptContent = $('#__NEXT_DATA__').html();
      if (scriptContent) {
        console.log(
          '[HoneyManga Debug] Found __NEXT_DATA__, length:',
          scriptContent.length,
        );
        // Тут можна спробувати розпарсити JSON якщо є дані
      }
    }

    if (chapterContent) {
      return chapterContent;
    }

    throw new Error(
      `Не вдалося завантажити розділ. URL: ${url}, HTML length: ${html.length}`,
    );
  }

  async fetchImage(url: string): Promise<Response> {
    return fetchApi(url);
  }

  filters = {} satisfies Filters;
}

export default new HoneyManga();
