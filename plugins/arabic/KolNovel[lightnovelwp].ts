import { load } from 'cheerio';
import { Parser } from 'htmlparser2';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';
import { Filters } from '@libs/filterInputs';
import { storage } from '@libs/storage';

type LightNovelWPOptions = {
  reverseChapters?: boolean;
  lang?: string;
  versionIncrements?: number;
  seriesPath?: string;
  customJs?: string;
  hasLocked?: boolean;
};

export type LightNovelWPMetadata = {
  id: string;
  sourceSite: string;
  sourceName: string;
  options?: LightNovelWPOptions;
  filters?: any;
};

class LightNovelWPPlugin implements Plugin.PluginBase {
  id: string;
  name: string;
  icon: string;
  site: string;
  version: string;
  options?: LightNovelWPOptions;
  filters?: Filters;

  hideLocked = storage.get('hideLocked');
  pluginSettings?: Record<string, any>;

  constructor(metadata: LightNovelWPMetadata) {
    this.id = metadata.id;
    this.name = metadata.sourceName;
    this.icon = `multisrc/lightnovelwp/${metadata.id.toLowerCase()}/icon.png`;
    this.site = metadata.sourceSite;
    const versionIncrements = metadata.options?.versionIncrements || 0;
    this.version = `1.1.${9 + versionIncrements}`;
    this.options = metadata.options ?? ({} as LightNovelWPOptions);
    this.filters = metadata.filters satisfies Filters;

    if (this.options?.hasLocked) {
      this.pluginSettings = {
        hideLocked: {
          value: '',
          label: 'Hide locked chapters',
          type: 'Switch',
        },
      };
    }
  }

  getHostname(url: string): string {
    url = url.split('/')[2];
    const url_parts = url.split('.');
    url_parts.pop(); // remove TLD
    return url_parts.join('.');
  }

  async safeFecth(url: string, search: boolean): Promise<string> {
    const urlParts = url.split('://');
    const protocol = urlParts.shift();
    const sanitizedUri = urlParts[0].replace(/\/\//g, '/');
    const r = await fetchApi(protocol + '://' + sanitizedUri);
    if (!r.ok && search != true)
      throw new Error(
        'Could not reach site (' + r.status + ') try to open in webview.',
      );
    const data = await r.text();
    const title = data.match(/<title>(.*?)<\/title>/)?.[1]?.trim();

    if (
      this.getHostname(url) != this.getHostname(r.url) ||
      (title &&
        (title == 'Bot Verification' ||
          title == 'You are being redirected...' ||
          title == 'Un instant...' ||
          title == 'Just a moment...' ||
          title == 'Redirecting...'))
    )
      throw new Error(
        'Captcha error, please open in webview (or the website has changed url)',
      );

    return data;
  }

  parseNovels(html: string): Plugin.NovelItem[] {
    html = load(html).html(); // fix "'" beeing replaced by "&#8217;" (html entities)
    const novels: Plugin.NovelItem[] = [];

    const articles = html.match(/<article([^]*?)<\/article>/g) || [];
    articles.forEach(article => {
      const [, novelUrl, novelName] =
        article.match(/<a href="([^\"]*)".*? title="([^\"]*)"/) || [];

      if (novelName && novelUrl) {
        const novelCover =
          article.match(
            /<img [^>]*?src="([^\"]*)"[^>]*?(?: data-src="([^\"]*)")?[^>]*>/,
          ) || [];

        let novelPath;
        if (novelUrl.includes(this.site)) {
          novelPath = novelUrl.replace(this.site, '');
        } else {
          // TODO: report website new url to server
          const novelParts = novelUrl.split('/');
          novelParts.shift();
          novelParts.shift();
          novelParts.shift();
          novelPath = novelParts.join('/');
        }

        novels.push({
          name: novelName,
          cover: novelCover[2] || novelCover[1] || defaultCover,
          path: novelPath,
        });
      }
    });

    return novels;
  }

  async popularNovels(
    pageNo: number,
    {
      filters,
      showLatestNovels,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const seriesPath = this.options?.seriesPath ?? '/series/';
    let url = this.site + seriesPath + '?page=' + pageNo;
    if (!filters) filters = this.filters || {};
    if (showLatestNovels) url += '&order=latest';
    for (const key in filters) {
      if (typeof filters[key].value === 'object')
        for (const value of filters[key].value as string[])
          url += `&${key}=${value}`;
      else if (filters[key].value) url += `&${key}=${filters[key].value}`;
    }
    const html = await this.safeFecth(url, false);
    return this.parseNovels(html);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const baseURL = this.site;
    const html = await this.safeFecth(baseURL + novelPath, false);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: '',
      genres: '',
      summary: '',
      author: '',
      artist: '',
      status: '',
      chapters: [] as Plugin.ChapterItem[],
    };
    let isParsingGenres = false;
    let isReadingGenre = false;
    let isReadingSummary = 0;
    let isParsingInfo = false;
    let isReadingInfo = false;
    let isReadingAuthor = false;
    let isReadingArtist = false;
    let isReadingStatus = false;
    let isParsingChapterList = false;
    let isReadingChapter = false;
    let isReadingChapterInfo = 0;
    let isPaidChapter = false;
    let hasLockItemOnChapterNum = false;
    const chapters: Plugin.ChapterItem[] = [];
    let tempChapter = {} as Plugin.ChapterItem;
    const hideLocked = this.hideLocked;

    const parser = new Parser({
      onopentag(name, attribs) {
        // name and cover
        if (!novel.cover && attribs['class']?.includes('ts-post-image')) {
          novel.name = attribs['title'];
          novel.cover = attribs['data-src'] || attribs['src'] || defaultCover;
        } // genres
        else if (
          attribs['class'] === 'genxed' ||
          attribs['class'] === 'sertogenre'
        ) {
          isParsingGenres = true;
        } else if (isParsingGenres && name === 'a') {
          isReadingGenre = true;
        } // summary
        else if (
          name === 'div' &&
          (attribs['class'] === 'entry-content' ||
            attribs['itemprop'] === 'description')
        ) {
          isReadingSummary++;
        } // author and status
        else if (attribs['class'] === 'spe' || attribs['class'] === 'serl') {
          isParsingInfo = true;
        } else if (isParsingInfo && name === 'span') {
          isReadingInfo = true;
        } else if (name === 'div' && attribs['class'] === 'sertostat') {
          isParsingInfo = true;
          isReadingInfo = true;
          isReadingStatus = true;
        }
        // chapters
        else if (attribs['class'] && attribs['class'].includes('eplister')) {
          isParsingChapterList = true;
        } else if (isParsingChapterList && name === 'li') {
          isReadingChapter = true;
        } else if (isReadingChapter) {
          if (name === 'a' && tempChapter.path === undefined) {
            tempChapter.path = attribs['href'].replace(baseURL, '').trim();
          } else if (attribs['class'] === 'epl-num') {
            isReadingChapterInfo = 1;
          } else if (attribs['class'] === 'epl-title') {
            isReadingChapterInfo = 2;
          } else if (attribs['class'] === 'epl-date') {
            isReadingChapterInfo = 3;
          } else if (attribs['class'] === 'epl-price') {
            isReadingChapterInfo = 4;
          }
        } else if (isReadingSummary && (name === 'div' || name === 'script')) {
          isReadingSummary++;
        }
      },
      ontext(data) {
        // genres
        if (isParsingGenres) {
          if (isReadingGenre) {
            novel.genres += data + ', ';
          }
        } // summary
        else if (isReadingSummary === 1 && data.trim()) {
          novel.summary += data;
        } // author and status
        else if (isParsingInfo) {
          if (isReadingInfo) {
            const detailName = data.toLowerCase().replace(':', '').trim();

            if (isReadingAuthor) {
              novel.author += data || 'Unknown';
            } else if (isReadingArtist) {
              novel.artist += data || 'Unknown';
            } else if (isReadingStatus) {
              switch (detailName) {
                case 'مكتملة':
                case 'completed':
                case 'complété':
                case 'completo':
                case 'completado':
                case 'tamamlandı':
                  novel.status = NovelStatus.Completed;
                  break;
                case 'مستمرة':
                case 'ongoing':
                case 'en cours':
                case 'em andamento':
                case 'en progreso':
                case 'devam ediyor':
                  novel.status = NovelStatus.Ongoing;
                  break;
                case 'متوقفة':
                case 'hiatus':
                case 'en pause':
                case 'hiato':
                case 'pausa':
                case 'pausado':
                case 'duraklatıldı':
                  novel.status = NovelStatus.OnHiatus;
                  break;
                default:
                  novel.status = NovelStatus.Unknown;
                  break;
              }
            }

            switch (detailName) {
              case 'الكاتب':
              case 'author':
              case 'auteur':
              case 'autor':
              case 'yazar':
                isReadingAuthor = true;
                break;
              case 'الحالة':
              case 'status':
              case 'statut':
              case 'estado':
              case 'durum':
                isReadingStatus = true;
                break;
              case 'الفنان':
              case 'artist':
              case 'artiste':
              case 'artista':
              case 'çizer':
                isReadingArtist = true;
                break;
            }
          }
        } // chapters
        else if (isParsingChapterList) {
          if (isReadingChapter) {
            if (isReadingChapterInfo === 1) {
              if (data.includes('🔒')) {
                isPaidChapter = true;
                hasLockItemOnChapterNum = true;
              } else if (hasLockItemOnChapterNum) {
                isPaidChapter = false;
              }
              extractChapterNumber(data, tempChapter);
            } else if (isReadingChapterInfo === 2) {
              tempChapter.name =
                data
                  .match(
                    RegExp(
                      `^${novel.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(.+)`,
                    ),
                  )?.[1]
                  ?.trim() || data.trim();
              if (!tempChapter.chapterNumber) {
                extractChapterNumber(data, tempChapter);
              }
            } else if (isReadingChapterInfo === 3) {
              tempChapter.releaseTime = data; //new Date(data).toISOString();
            } else if (isReadingChapterInfo === 4) {
              const detailName = data.toLowerCase().trim();
              switch (detailName) {
                case 'free':
                case 'gratuit':
                case 'مجاني':
                case 'livre':
                case '':
                  isPaidChapter = false;
                  break;
                default:
                  isPaidChapter = true;
                  break;
              }
            }
          }
        }
      },
      onclosetag(name) {
        // genres
        if (isParsingGenres) {
          if (isReadingGenre) {
            isReadingGenre = false; // stop reading genre
          } else {
            isParsingGenres = false; // stop parsing genres
            novel.genres = novel.genres?.slice(0, -2); // remove trailing comma
          }
        } // summary
        else if (isReadingSummary) {
          if (name === 'p') {
            novel.summary += '\n\n';
          } else if (name === 'br') {
            novel.summary += '\n';
          } else if (name === 'div' || name === 'script') {
            isReadingSummary--;
          }
        } // author and status
        else if (isParsingInfo) {
          if (isReadingInfo) {
            if (name === 'span') {
              isReadingInfo = false;
              if (isReadingAuthor && novel.author) {
                isReadingAuthor = false;
              } else if (isReadingArtist && novel.artist) {
                isReadingArtist = false;
              } else if (isReadingStatus && novel.status !== '') {
                isReadingStatus = false;
              }
            }
          } else if (name === 'div') {
            isParsingInfo = false;
            novel.author = novel.author?.trim();
            novel.artist = novel.artist?.trim();
          }
        } // chapters
        else if (isParsingChapterList) {
          if (isReadingChapter) {
            if (isReadingChapterInfo === 1) {
              isReadingChapterInfo = 0;
            } else if (isReadingChapterInfo === 2) {
              isReadingChapterInfo = 0;
            } else if (isReadingChapterInfo === 3) {
              isReadingChapterInfo = 0;
            } else if (isReadingChapterInfo === 4) {
              isReadingChapterInfo = 0;
            } else if (name === 'li') {
              isReadingChapter = false;
              if (!tempChapter.chapterNumber) tempChapter.chapterNumber = 0;
              if (isPaidChapter) tempChapter.name = '🔒 ' + tempChapter.name;
              if (!hideLocked || !isPaidChapter) chapters.push(tempChapter);
              tempChapter = {} as Plugin.ChapterItem;
            }
          } else if (name === 'ul') {
            isParsingChapterList = false;
          }
        }
      },
    });

    parser.write(html);
    parser.end();

    if (chapters.length) {
      if (this.options?.reverseChapters) chapters.reverse();
      novel.chapters = chapters;
    }

    novel.summary = novel.summary.trim();

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    let data = await this.safeFecth(this.site + chapterPath, false);
    if (this.options?.customJs) {
      try {
        const $ = load(data);
        $('article > style')
          .text()
          .match(/\.\w+(?=\s*[,{])/g)
          ?.forEach(tag => $(`p${tag}`).remove());
        $('.epcontent .code-block').remove();
        data = $.html();
      } catch (error) {
        console.error('Error executing customJs:', error);
        throw error;
      }
    }
    return (
      data
        .match(/<div.*?class="epcontent ([^]*?)<div.*?class="?bottomnav/g)?.[0]
        .match(/<p[^>]*>([^]*?)<\/p>/g)
        ?.join('\n') || ''
    );
  }

  async searchNovels(
    searchTerm: string,
    page: number,
  ): Promise<Plugin.NovelItem[]> {
    const url =
      this.site + 'page/' + page + '/?s=' + encodeURIComponent(searchTerm);
    const html = await this.safeFecth(url, true);
    return this.parseNovels(html);
  }
}

function extractChapterNumber(data: string, tempChapter: Plugin.ChapterItem) {
  const tempChapterNumber = data.match(/(\d+)$/);
  if (tempChapterNumber && tempChapterNumber[0]) {
    tempChapter.chapterNumber = parseInt(tempChapterNumber[0]);
  }
}

const plugin = new LightNovelWPPlugin({
  'id': 'kolnovel',
  'sourceSite': 'https://kolnovel.site/',
  'sourceName': 'Kol Novel',
  'options': {
    'lang': 'Arabic',
    'reverseChapters': true,
    'customJs':
      "$('article > style').text().match(/\\.\\w+(?=\\s*[,{])/g)?.forEach(tag => $(`p${tag}`).remove());$('.epcontent .code-block').remove();",
    'versionIncrements': 9,
  },
  'filters': {
    'genre[]': {
      'type': 'Checkbox',
      'label': 'تصنيف',
      'value': [],
      'options': [
        { 'label': 'Romance', 'value': 'romance' },
        { 'label': 'Shounen Ai', 'value': 'shounen-ai' },
        { 'label': 'Wuxia', 'value': 'wuxia' },
        { 'label': 'Xianxia', 'value': 'xianxia' },
        { 'label': 'XUANHUAN', 'value': 'xuanhuan' },
        { 'label': 'أبطال خارقين', 'value': 'أبطال-خارقين' },
        { 'label': 'أساطير', 'value': 'أساطير' },
        { 'label': 'أشباح', 'value': 'أشباح' },
        { 'label': 'أكشن', 'value': 'action' },
        { 'label': 'ألعاب', 'value': 'ألعاب' },
        { 'label': 'إثارة', 'value': 'excitement' },
        { 'label': 'إسلامي', 'value': 'إسلامي' },
        { 'label': 'إنتقال الى عالم أخر', 'value': 'isekai' },
        { 'label': 'إيتشي', 'value': 'etchi' },
        { 'label': 'اكاديمي', 'value': 'اكاديمي' },
        { 'label': 'اكشن', 'value': 'اكشن' },
        { 'label': 'الإثارة', 'value': 'الإثارة' },
        { 'label': 'الخيال العلمي', 'value': 'sci-fi' },
        { 'label': 'الدراما', 'value': 'الدراما' },
        { 'label': 'المغامرات', 'value': 'المغامرات' },
        { 'label': 'انتقام', 'value': 'انتقام' },
        { 'label': 'بطل مضاد', 'value': 'بطل-مضاد' },
        { 'label': 'بطل ناضج', 'value': 'بطل-ناضج' },
        { 'label': 'بقاء', 'value': 'بقاء' },
        { 'label': 'بناء مملكة', 'value': 'بناء-مملكة' },
        { 'label': 'بوليسي', 'value': 'policy' },
        { 'label': 'تاريخ', 'value': 'تاريخ' },
        { 'label': 'تاريخي', 'value': 'historical' },
        { 'label': 'تحقيقات', 'value': 'تحقيق' },
        { 'label': 'تشويق', 'value': 'تشويق' },
        { 'label': 'تقمص شخصيات', 'value': 'rpg' },
        { 'label': 'تلاعب', 'value': 'تلاعب' },
        { 'label': 'تناسخ', 'value': 'تناسخ' },
        { 'label': 'جريمة', 'value': 'crime' },
        { 'label': 'جوسى', 'value': 'josei' },
        { 'label': 'جوسي', 'value': 'جوسي' },
        { 'label': 'حريم', 'value': 'harem' },
        { 'label': 'حل الألغاز', 'value': 'حل-الألغاز' },
        { 'label': 'حياة مدرسية', 'value': 'school-life' },
        { 'label': 'خارق للطبيعة', 'value': 'خارق-للطبيعة' },
        { 'label': 'خيال', 'value': 'خيال' },
        { 'label': 'خيال علمي', 'value': 'خيال-علمي' },
        { 'label': 'خيالي', 'value': 'خيالي' },
        { 'label': 'خيالي(فانتازيا)', 'value': 'fantasy' },
        { 'label': 'دراما', 'value': 'drama' },
        { 'label': 'درامي', 'value': 'درامي' },
        { 'label': 'رعب', 'value': 'horror' },
        { 'label': 'رعب كوني', 'value': 'رعب-كوني' },
        { 'label': 'رعب نفسي', 'value': 'رعب-نفسي' },
        { 'label': 'رومانسي', 'value': 'romantic' },
        { 'label': 'رومانسية', 'value': 'رومانسية' },
        { 'label': 'رومنسية', 'value': 'رومنسية' },
        { 'label': 'زنزانة', 'value': 'زنزانة' },
        { 'label': 'زيانشيا', 'value': 'زيانشيا' },
        { 'label': 'ستيم بانك', 'value': 'ستيم-بانك' },
        { 'label': 'سحر', 'value': 'magic' },
        { 'label': 'سفر بالزمن', 'value': 'سفر-بالزمن' },
        { 'label': 'سفر عبر الزمن', 'value': 'سفر-عبر-الزمن' },
        { 'label': 'سياسة', 'value': 'سياسة' },
        { 'label': 'سينن', 'value': 'senen' },
        { 'label': 'شريحة من الحياة', 'value': 'slice-of-life' },
        { 'label': 'شعر', 'value': 'شعر' },
        { 'label': 'شوانهان', 'value': 'شوانهان' },
        { 'label': 'شوانهوان', 'value': 'شوانهوان' },
        { 'label': 'شوجو', 'value': 'shojo' },
        { 'label': 'شونين', 'value': 'shonen' },
        { 'label': 'شيانشيا', 'value': 'شيانشيا' },
        { 'label': 'طبي', 'value': 'medical' },
        { 'label': 'ظواهر خارقة للطبيعة', 'value': 'supernatural' },
        { 'label': 'عائلي', 'value': 'عائلي' },
        { 'label': 'عموض', 'value': 'عموض' },
        { 'label': 'غموض', 'value': 'mysteries' },
        { 'label': 'فانتازي', 'value': 'فانتازي' },
        { 'label': 'فانتازيا', 'value': 'فانتازيا' },
        { 'label': 'فانفيك', 'value': 'فانفيك' },
        { 'label': 'فنتازيا', 'value': 'فنتازيا' },
        { 'label': 'فنون القتال', 'value': 'martial-arts' },
        { 'label': 'فنون قتال', 'value': 'فنون-قتال' },
        { 'label': 'قصة قصيرة', 'value': 'قصة-قصيرة' },
        { 'label': 'قوة خارقة', 'value': 'قوة-خارقة' },
        { 'label': 'قوى خارقة', 'value': 'superpower' },
        { 'label': 'كوميدي', 'value': 'comedy' },
        { 'label': 'كوميديا', 'value': 'كوميديا' },
        { 'label': 'كوميدية', 'value': 'كوميدية' },
        { 'label': 'مأسأة', 'value': 'مأسأة' },
        { 'label': 'مأساة', 'value': 'مأساة' },
        { 'label': 'مأساوي', 'value': 'tragedy' },
        { 'label': 'مؤامرة', 'value': 'مؤامرة' },
        { 'label': 'ما بعد الكارثة', 'value': 'after-the-disaster' },
        { 'label': 'ما بعد نهاية العالم', 'value': 'ما-بعد-نهاية-العالم' },
        { 'label': 'مضاد البطل', 'value': 'مضاد-البطل' },
        { 'label': 'مغامرات', 'value': 'مغامرات' },
        { 'label': 'مغامرة', 'value': 'adventure' },
        { 'label': 'ميكا', 'value': 'mechanical' },
        { 'label': 'ناضج', 'value': 'mature' },
        { 'label': 'نظام', 'value': 'نظام' },
        { 'label': 'نفسي', 'value': 'psychological' },
        { 'label': 'ون شوت', 'value': 'ون-شوت' },
        { 'label': 'ووشيا', 'value': 'ووشيا' },
        { 'label': 'ووكسيا', 'value': 'ووكسيا' },
      ],
    },
    'type[]': {
      'type': 'Checkbox',
      'label': 'النوع',
      'value': [],
      'options': [
        { 'label': 'إنجليزية', 'value': 'english' },
        { 'label': 'ترجمة إحترافية', 'value': 'ترجمة-إحترافية' },
        { 'label': 'رواية لايت', 'value': 'light-novel' },
        { 'label': 'رواية مؤلفة', 'value': 'رواية-مؤلفة' },
        { 'label': 'رواية مترجمة', 'value': 'رواية-مترجمة' },
        { 'label': 'رواية ويب', 'value': 'web-novel' },
        { 'label': 'صينية', 'value': 'chinese' },
        { 'label': 'عربية', 'value': 'arabic' },
        { 'label': 'كورية', 'value': 'korean' },
        { 'label': 'مؤلفة', 'value': 'مؤلفة' },
        { 'label': 'ون شوت', 'value': 'ون-شوت' },
        { 'label': 'يابانية', 'value': 'japanese' },
      ],
    },
    'status': {
      'type': 'Picker',
      'label': 'الحالة',
      'value': '',
      'options': [
        { 'label': 'الكل', 'value': '' },
        { 'label': 'Ongoing', 'value': 'ongoing' },
        { 'label': 'Hiatus', 'value': 'hiatus' },
        { 'label': 'Completed', 'value': 'completed' },
      ],
    },
    'order': {
      'type': 'Picker',
      'label': 'ترتيب حسب',
      'value': '',
      'options': [
        { 'label': 'الإعداد الأولي', 'value': '' },
        { 'label': 'A-Z', 'value': 'title' },
        { 'label': 'Z-A', 'value': 'titlereverse' },
        { 'label': 'أخر التحديثات', 'value': 'update' },
        { 'label': 'أخر ما تم إضافته', 'value': 'latest' },
        { 'label': 'الرائجة', 'value': 'popular' },
        { 'label': 'التقييم', 'value': 'rating' },
      ],
    },
  },
});
export default plugin;
