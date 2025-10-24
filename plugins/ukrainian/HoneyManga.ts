import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';

class HoneyManga implements Plugin.PluginBase {
  id = 'honeymanga';
  name = 'Honey Manga';
  icon = 'src/ukrainian/honeymanga/icon.png';
  site = 'https://honey-manga.com.ua';
  apiUrl = 'https://data.api.honey-manga.com.ua';
  version = '2.3.0';

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
    console.log('[HoneyManga] parseNovel novelPath:', novelPath);
    const novelId = novelPath.replace('/book/', '');
    console.log('[HoneyManga] parseNovel novelId:', novelId);
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
          const chapterPath = `/read/${novelId}/${chapter.id}`;

          console.log(
            '[HoneyManga] Chapter:',
            chapterName,
            'path:',
            chapterPath,
          );

          chapters.push({
            name: chapterName,
            path: chapterPath,
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
    console.log('[HoneyManga] chapterPath:', chapterPath);

    const pathParts = chapterPath.split('/');
    console.log('[HoneyManga] pathParts:', JSON.stringify(pathParts));

    const novelId = pathParts[2];
    const chapterId = pathParts[3];

    console.log('[HoneyManga] novelId:', novelId);
    console.log('[HoneyManga] chapterId:', chapterId);

    // API формат: /novel/{chapterId}/chapter/{novelId}/data
    // Зверніть увагу: порядок ID навпаки!
    const apiUrl = `${this.apiUrl}/novel/${chapterId}/chapter/${novelId}/data`;
    console.log('[HoneyManga] API URL:', apiUrl);

    const result = await fetchApi(apiUrl);
    const data = await result.json();

    let chapterContent = '';

    if (data && Array.isArray(data)) {
      // API повертає масив блоків у форматі BlockNote
      data.forEach((block: any) => {
        if (block.type === 'paragraph' && block.content) {
          // Витягуємо текст з content масиву
          block.content.forEach((contentItem: any) => {
            if (contentItem.type === 'text' && contentItem.text) {
              const text = contentItem.text;
              // Додаємо стилі якщо є
              let styledText = text;
              if (contentItem.styles) {
                if (contentItem.styles.bold) {
                  styledText = `<strong>${styledText}</strong>`;
                }
                if (contentItem.styles.italic) {
                  styledText = `<em>${styledText}</em>`;
                }
              }
              chapterContent += styledText;
            }
          });
          chapterContent += '<br/>\n';
        } else if (block.type === 'heading' && block.content) {
          // Заголовки
          let headingText = '';
          block.content.forEach((contentItem: any) => {
            if (contentItem.type === 'text' && contentItem.text) {
              headingText += contentItem.text;
            }
          });
          const level = block.props?.level || 1;
          chapterContent += `<h${level}>${headingText}</h${level}>\n`;
        } else if (block.type === 'image' && block.props?.url) {
          // Зображення
          chapterContent += `<img src="${block.props.url}" />\n`;
        }
      });
    }

    if (chapterContent) {
      return chapterContent;
    }

    throw new Error(
      `Не вдалося завантажити розділ. API: ${apiUrl}, Response length: ${JSON.stringify(data).length}`,
    );
  }

  async fetchImage(url: string): Promise<Response> {
    return fetchApi(url);
  }

  filters = {} satisfies Filters;
}

export default new HoneyManga();
