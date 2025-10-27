import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters } from '@libs/filterInputs';

class HoneyManga implements Plugin.PluginBase {
  id = 'honeymanga';
  name = 'Honey Manga';
  icon = 'src/ukrainian/honeymanga/icon.png';
  site = 'https://honey-manga.com.ua';
  apiUrl = 'https://data.api.honey-manga.com.ua';
  cdnUrl = 'https://hmvolumestorage.b-cdn.net/public-resources';
  version = '3.4.0';

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
            ? `${this.cdnUrl}/${item.posterUrl}`
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
            ? `${this.cdnUrl}/${item.posterUrl}`
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
      cover: data.posterUrl ? `${this.cdnUrl}/${data.posterUrl}` : undefined,
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

          // Правильний порядок: /read/{chapterId}/{novelId}
          chapters.push({
            name: chapterName,
            path: `/read/${chapter.id}/${novelId}`,
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
    // chapterPath має формат /read/{chapterId}/{novelId}
    const pathParts = chapterPath.split('/');
    const chapterId = pathParts[2]; // перший ID - це chapterId
    const novelId = pathParts[3]; // другий ID - це novelId

    // API формат: /novel/{chapterId}/chapter/{novelId}/data
    // Зверніть увагу: порядок ID навпаки!
    const apiUrl = `${this.apiUrl}/novel/${chapterId}/chapter/${novelId}/data`;

    const result = await fetchApi(apiUrl);
    const data = await result.json();

    let chapterContent = '';

    if (data && Array.isArray(data)) {
      // API повертає масив блоків у форматі BlockNote
      data.forEach((block: any) => {
        if (block.type === 'paragraph') {
          // Витягуємо текст з content масиву
          if (block.content && Array.isArray(block.content)) {
            block.content.forEach((contentItem: any) => {
              if (contentItem.type === 'text' && contentItem.text) {
                let text = contentItem.text;
                // Додаємо стилі якщо є
                if (contentItem.styles) {
                  if (contentItem.styles.bold) {
                    text = `<strong>${text}</strong>`;
                  }
                  if (contentItem.styles.italic) {
                    text = `<em>${text}</em>`;
                  }
                }
                chapterContent += text;
              }
            });
          }
          chapterContent += '<br/><br/>\n';
        } else if (block.type === 'heading') {
          // Заголовки
          let headingText = '';
          if (block.content && Array.isArray(block.content)) {
            block.content.forEach((contentItem: any) => {
              if (contentItem.type === 'text' && contentItem.text) {
                headingText += contentItem.text;
              }
            });
          }
          const level = block.props?.level || 1;
          chapterContent += `<h${level}>${headingText}</h${level}>\n`;
        } else if (block.type === 'image' && block.props?.url) {
          // Зображення
          const imgUrl = block.props.url.startsWith('http')
            ? block.props.url
            : `${this.cdnUrl}/${block.props.url}`;
          chapterContent += `<img src="${imgUrl}" />\n`;
        }
      });
    }

    if (chapterContent) {
      return chapterContent;
    }

    // Діагностична інформація в помилці
    const diagnosticInfo = `
[ДІАГНОСТИКА v3.0.1]
chapterPath: ${chapterPath}
pathParts: [${pathParts.join(', ')}]
novelId: ${novelId}
chapterId: ${chapterId}
API URL: ${apiUrl}
Response status: ${result.status}
Data is Array: ${Array.isArray(data)}
Data length: ${Array.isArray(data) ? data.length : 'N/A'}
Response preview: ${JSON.stringify(data).substring(0, 200)}
    `.trim();

    throw new Error(`Не вдалося завантажити розділ.\n\n${diagnosticInfo}`);
  }

  async fetchImage(url: string): Promise<Response> {
    return fetchApi(url);
  }

  filters = {} satisfies Filters;
}

export default new HoneyManga();
