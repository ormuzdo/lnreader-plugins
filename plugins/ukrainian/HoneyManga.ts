import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';

class HoneyManga implements Plugin.PluginBase {
  id = 'honeymanga';
  name = 'Honey Manga';
  icon = 'src/ukrainian/honeymanga/icon.png';
  site = 'https://honey-manga.com.ua';
  apiUrl = 'https://data.api.honey-manga.com.ua';
  version = '2.0.2';

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
            path: `/book/${novelId}/chapter/${chapter.id}`,
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
    // chapterPath має формат /book/{novelId}/chapter/{chapterId}
    const pathParts = chapterPath.split('/');
    const novelId = pathParts[2]; // /book/{novelId}/chapter/{chapterId}
    const chapterId = pathParts[4];

    const url = `${this.apiUrl}/v2/chapter/frames/${novelId}/${chapterId}`;

    console.log('[HoneyManga Debug] chapterPath:', chapterPath);
    console.log('[HoneyManga Debug] novelId:', novelId);
    console.log('[HoneyManga Debug] chapterId:', chapterId);
    console.log('[HoneyManga Debug] API URL:', url);

    const result = await fetchApi(url);
    const data = await result.json();

    console.log('[HoneyManga Debug] API response status:', result.status);
    console.log(
      '[HoneyManga Debug] API response data:',
      JSON.stringify(data).substring(0, 200),
    );

    // API повертає масив frames, кожен frame може містити text або imageUrl
    let chapterContent = '';

    if (data && Array.isArray(data)) {
      console.log('[HoneyManga Debug] Frames count:', data.length);
      data.forEach((frame: any) => {
        if (frame.text) {
          chapterContent += `<p>${frame.text}</p>\n`;
        }
        // Якщо є зображення, можна додати їх теж
        if (frame.imageUrl) {
          chapterContent += `<img src="${frame.imageUrl}" />\n`;
        }
      });
    } else {
      console.log('[HoneyManga Debug] Data is not an array:', typeof data);
    }

    if (chapterContent) {
      return chapterContent;
    }

    throw new Error(
      `Не вдалося завантажити розділ: контент відсутній. URL: ${url}, Response: ${JSON.stringify(data)}`,
    );
  }

  async fetchImage(url: string): Promise<Response> {
    return fetchApi(url);
  }

  filters = {} satisfies Filters;
}

export default new HoneyManga();
