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
  'id': 'knoxt',
  'sourceSite': 'https://knoxt.space/',
  'sourceName': 'KnoxT',
  'options': { 'lang': 'English', 'reverseChapters': true },
  'filters': {
    'genre[]': {
      'type': 'Checkbox',
      'label': 'Genre',
      'value': [],
      'options': [
        { 'label': '1v1', 'value': '1v1' },
        { 'label': 'ABO', 'value': 'abo' },
        { 'label': 'Absent Parents', 'value': 'absent-parents' },
        { 'label': 'Action', 'value': 'action' },
        { 'label': 'Adapted to Drama CD', 'value': 'adapted-to-drama-cd' },
        { 'label': 'Adult', 'value': 'adult' },
        { 'label': 'Adults', 'value': 'adults' },
        { 'label': 'Adventure', 'value': 'adventure' },
        { 'label': 'Adventurers', 'value': 'adventurers' },
        { 'label': 'Age gap', 'value': 'age-gap' },
        { 'label': 'Age Regression', 'value': 'age-regression' },
        { 'label': 'Aggressive Characters', 'value': 'aggressive-characters' },
        { 'label': 'Amnesia', 'value': 'amnesia' },
        { 'label': 'Ancient times', 'value': 'ancient-times' },
        {
          'label': 'Anti-social Protagonist',
          'value': 'anti-social-protagonist',
        },
        { 'label': 'Appearance Changes', 'value': 'appearance-changes' },
        { 'label': 'Arranged Marriage', 'value': 'arranged-marriage' },
        { 'label': 'Arrogant Characters', 'value': 'arrogant-characters' },
        {
          'label': 'Artificial Intelligence',
          'value': 'artificial-intelligence',
        },
        { 'label': 'Artists', 'value': 'artists' },
        { 'label': 'Beautiful bottom', 'value': 'beautiful-bottom' },
        { 'label': 'Betrayal', 'value': 'betrayal' },
        { 'label': 'Bickering Couple', 'value': 'bickering-couple' },
        { 'label': 'BL', 'value': 'bl' },
        { 'label': "BL (Boys' Love)", 'value': 'bl-boys-love' },
        { 'label': 'Blind Dates', 'value': 'blind-dates' },
        { 'label': 'Blind Protagonist', 'value': 'blind-protagonist' },
        { 'label': 'book wearing', 'value': 'book-wearing' },
        { 'label': 'Boys love', 'value': 'boys-love' },
        { 'label': 'Business Management', 'value': 'business-management' },
        { 'label': 'Businessmen', 'value': 'businessmen' },
        { 'label': 'Calm Protagonist', 'value': 'calm-protagonist' },
        { 'label': 'Campus', 'value': 'campus' },
        { 'label': 'carefree protagonist', 'value': 'carefree-protagonist' },
        { 'label': 'Caring Protagonist', 'value': 'caring-protagonist' },
        { 'label': 'celebrity', 'value': 'celebrity' },
        { 'label': 'CEO', 'value': 'ceo' },
        { 'label': 'Character Growth', 'value': 'character-growth' },
        {
          'label': 'Charismatic Protagonist',
          'value': 'charismatic-protagonist',
        },
        { 'label': 'Charming Protagonist', 'value': 'charming-protagonist' },
        { 'label': 'Child Abuse', 'value': 'child-abuse' },
        { 'label': 'Childcare', 'value': 'childcare' },
        { 'label': 'Childhood Friends', 'value': 'childhood-friends' },
        { 'label': 'Childhood Love', 'value': 'childhood-love' },
        { 'label': 'Childish Protagonist', 'value': 'childish-protagonist' },
        { 'label': 'Chinese novel', 'value': 'chinese-novel' },
        { 'label': 'Clever Protagonist', 'value': 'clever-protagonist' },
        { 'label': 'Clingy Lover', 'value': 'clingy-lover' },
        { 'label': 'Clumsy Love Interests', 'value': 'clumsy-love-interests' },
        { 'label': 'Cohabitation', 'value': 'cohabitation' },
        { 'label': 'Cold Love Interests', 'value': 'cold-love-interests' },
        { 'label': 'Cold Protagonist', 'value': 'cold-protagonist' },
        { 'label': 'Comdey', 'value': 'comdey' },
        { 'label': 'comedic undertone', 'value': 'comedic-undertone' },
        { 'label': 'Comedy', 'value': 'comedy' },
        {
          'label': 'Complex Family Relationships',
          'value': 'complex-family-relationships',
        },
        { 'label': 'Confident Protagonist', 'value': 'confident-protagonist' },
        { 'label': 'Conflicting Loyalties', 'value': 'conflicting-loyalties' },
        { 'label': 'Cooking', 'value': 'cooking' },
        { 'label': 'Couple Growth', 'value': 'couple-growth' },
        { 'label': 'Crime', 'value': 'crime' },
        { 'label': 'Cross-dressing', 'value': 'cross-dressing' },
        { 'label': 'Cryostasis', 'value': 'cryostasis' },
        { 'label': 'Cute Children', 'value': 'cute-children' },
        { 'label': 'Cute Protagonist', 'value': 'cute-protagonist' },
        { 'label': 'Cute Story', 'value': 'cute-story' },
        { 'label': 'Death of Loved Ones', 'value': 'death-of-loved-ones' },
        {
          'label': 'Determined Protagonist',
          'value': 'determined-protagonist',
        },
        {
          'label': 'Devoted Love Interests',
          'value': 'devoted-love-interests',
        },
        {
          'label': 'Different Social Status',
          'value': 'different-social-status',
        },
        { 'label': 'Divorce', 'value': 'divorce' },
        { 'label': 'Doctors', 'value': 'doctors' },
        { 'label': 'Doting love interest', 'value': 'doting-love-interest' },
        { 'label': 'Doting Love Interests', 'value': 'doting-love-interests' },
        { 'label': 'Doting Older Siblings', 'value': 'doting-older-siblings' },
        { 'label': 'Doting Parents', 'value': 'doting-parents' },
        { 'label': 'Double AA', 'value': 'double-aa' },
        { 'label': 'Drama', 'value': 'drama' },
        { 'label': 'Dystopia', 'value': 'dystopia' },
        { 'label': 'empowerment fiction', 'value': 'empowerment-fiction' },
        { 'label': 'Enemies Become Lovers', 'value': 'enemies-become-lovers' },
        { 'label': 'Entertaiment circle', 'value': 'entertaiment-circle' },
        { 'label': 'Entertainment circle', 'value': 'entertainment-circle' },
        { 'label': 'Evolution', 'value': 'evolution' },
        { 'label': 'F*llatio', 'value': 'fllatio' },
        { 'label': 'Family Conflict', 'value': 'family-conflict' },
        { 'label': 'Fantasy', 'value': 'fantasy' },
        { 'label': 'Farming', 'value': 'farming' },
        { 'label': 'Fated Lovers', 'value': 'fated-lovers' },
        { 'label': 'Fearless Protagonist', 'value': 'fearless-protagonist' },
        { 'label': 'Fiction', 'value': 'fiction' },
        { 'label': 'Fictional', 'value': 'fictional' },
        { 'label': 'First Love', 'value': 'first-love' },
        { 'label': 'First-time Interc**rse', 'value': 'first-time-intercrse' },
        { 'label': 'futuristic setting', 'value': 'futuristic-setting' },
        { 'label': 'Gaming', 'value': 'gaming' },
        { 'label': 'Gender Bender', 'value': 'gender-bender' },
        { 'label': 'General', 'value': 'general' },
        { 'label': 'Genetic Modifications', 'value': 'genetic-modifications' },
        { 'label': 'GL', 'value': 'gl' },
        { 'label': 'Gore', 'value': 'gore' },
        { 'label': 'Handsome Male Lead', 'value': 'handsome-male-lead' },
        {
          'label': 'Hard-Working Protagonist',
          'value': 'hard-working-protagonist',
        },
        { 'label': 'Harem', 'value': 'harem' },
        { 'label': 'HE', 'value': 'he' },
        { 'label': 'Heartwarming', 'value': 'heartwarming' },
        { 'label': 'Hiding True Abilities', 'value': 'hiding-true-abilities' },
        { 'label': 'Hiding True Identity', 'value': 'hiding-true-identity' },
        { 'label': 'historic love', 'value': 'historic-love' },
        { 'label': 'Historical', 'value': 'historical' },
        { 'label': 'Horror', 'value': 'horror' },
        {
          'label': 'Human-Nonhuman Relationship',
          'value': 'human-nonhuman-relationship',
        },
        { 'label': 'humor', 'value': 'humor' },
        { 'label': 'Idol', 'value': 'idol' },
        { 'label': 'Inferiority Complex', 'value': 'inferiority-complex' },
        { 'label': 'infrastructure', 'value': 'infrastructure' },
        { 'label': 'interstellar', 'value': 'interstellar' },
        { 'label': 'Isekai', 'value': 'isekai' },
        { 'label': 'Jealousy', 'value': 'jealousy' },
        { 'label': 'Josei', 'value': 'josei' },
        { 'label': 'Kind love interest', 'value': 'kind-love-interest' },
        { 'label': 'Kind Love Interests', 'value': 'kind-love-interests' },
        { 'label': 'Lawyers', 'value': 'lawyers' },
        { 'label': 'lighthearted drama', 'value': 'lighthearted-drama' },
        { 'label': 'Loner Protagonist', 'value': 'loner-protagonist' },
        { 'label': 'Long Separations', 'value': 'long-separations' },
        { 'label': 'Love Affair', 'value': 'love-affair' },
        { 'label': 'Love and hate', 'value': 'love-and-hate' },
        { 'label': 'love at first sight', 'value': 'love-at-first-sight' },
        {
          'label': 'Love Interest Falls in Love First',
          'value': 'love-interest-falls-in-love-first',
        },
        { 'label': 'love romance', 'value': 'love-romance' },
        { 'label': 'Lovers Reunited', 'value': 'lovers-reunited' },
        { 'label': 'Male protagonist', 'value': 'male-protagonist' },
        { 'label': 'Male Yandere', 'value': 'male-yandere' },
        {
          'label': 'Manipulative Characters',
          'value': 'manipulative-characters',
        },
        { 'label': 'Manly Gay Couple', 'value': 'manly-gay-couple' },
        { 'label': 'Marriage', 'value': 'marriage' },
        {
          'label': 'Marriage of Convenience',
          'value': 'marriage-of-convenience',
        },
        { 'label': 'Martial Arts', 'value': 'martial-arts' },
        { 'label': 'Mary Sue', 'value': 'mary-sue' },
        { 'label': 'Mature', 'value': 'mature' },
        { 'label': 'Mecha', 'value': 'mecha' },
        { 'label': 'Medical Knowledge', 'value': 'medical-knowledge' },
        { 'label': 'Military', 'value': 'military' },
        { 'label': 'Misunderstandings', 'value': 'misunderstandings' },
        { 'label': 'Modern', 'value': 'modern' },
        { 'label': 'Modern day', 'value': 'modern-day' },
        { 'label': 'Mpreg', 'value': 'mpreg' },
        {
          'label': 'Multiple Reincarnated Individuals',
          'value': 'multiple-reincarnated-individuals',
        },
        { 'label': 'Multiple worlds', 'value': 'multiple-worlds' },
        { 'label': 'Music', 'value': 'music' },
        { 'label': 'Mute Character', 'value': 'mute-character' },
        { 'label': 'mutual crush', 'value': 'mutual-crush' },
        { 'label': 'mutual salvation', 'value': 'mutual-salvation' },
        { 'label': 'Mystery', 'value': 'mystery' },
        { 'label': 'Mystery Solving', 'value': 'mystery-solving' },
        { 'label': 'Naive Protagonist', 'value': 'naive-protagonist' },
        { 'label': 'Near-Death Experience', 'value': 'near-death-experience' },
        { 'label': 'Obsessive Love', 'value': 'obsessive-love' },
        { 'label': 'Older Love Interests', 'value': 'older-love-interests' },
        { 'label': 'Omegaverse', 'value': 'omegaverse' },
        { 'label': 'Orphans', 'value': 'orphans' },
        { 'label': 'Otherworld fantasy', 'value': 'otherworld-fantasy' },
        {
          'label': 'Overpowered protagonist',
          'value': 'overpowered-protagonist',
        },
        { 'label': 'Past Plays a Big Role', 'value': 'past-plays-a-big-role' },
        { 'label': 'Past Trauma', 'value': 'past-trauma' },
        {
          'label': 'Persistent Love Interests',
          'value': 'persistent-love-interests',
        },
        { 'label': 'police', 'value': 'police' },
        { 'label': 'Poor Protagonist', 'value': 'poor-protagonist' },
        { 'label': 'Possessive Characters', 'value': 'possessive-characters' },
        { 'label': 'post apocalypse', 'value': 'post-apocalypse' },
        { 'label': 'Post-apocalyptic', 'value': 'post-apocalyptic' },
        {
          'label': 'Post-apocalyptic background',
          'value': 'post-apocalyptic-background',
        },
        { 'label': 'Power Couple', 'value': 'power-couple' },
        { 'label': 'Pretend Lovers', 'value': 'pretend-lovers' },
        { 'label': 'Professional', 'value': 'professional' },
        { 'label': 'Prosecutor', 'value': 'prosecutor' },
        {
          'label': 'Protagonist Falls in Love First',
          'value': 'protagonist-falls-in-love-first',
        },
        {
          'label': 'Protagonist Strong from the Start',
          'value': 'protagonist-strong-from-the-start',
        },
        { 'label': 'Psychological', 'value': 'psychological' },
        { 'label': 'Quick transmigration', 'value': 'quick-transmigration' },
        { 'label': 'R-18', 'value': 'r-18' },
        { 'label': 'REBIRTH', 'value': 'rebirth' },
        { 'label': 'Reconciliation', 'value': 'reconciliation' },
        { 'label': 'Redemption', 'value': 'redemption' },
        { 'label': 'Regression', 'value': 'regression' },
        { 'label': 'Reincarnation', 'value': 'reincarnation' },
        { 'label': 'reunion', 'value': 'reunion' },
        { 'label': 'Reverse Harem', 'value': 'reverse-harem' },
        { 'label': 'Rich to Poor', 'value': 'rich-to-poor' },
        { 'label': 'Romance', 'value': 'romance' },
        { 'label': 'S*x Friends', 'value': 'sx-friends' },
        { 'label': 'School Life', 'value': 'school-life' },
        { 'label': 'Sci-fi', 'value': 'sci-fi' },
        { 'label': 'sci-fi elements', 'value': 'sci-fi-elements' },
        { 'label': 'science fiction', 'value': 'science-fiction' },
        { 'label': 'Second Chance', 'value': 'second-chance' },
        { 'label': 'Secret Crush', 'value': 'secret-crush' },
        { 'label': 'Secret Identity', 'value': 'secret-identity' },
        { 'label': 'Secret Relationship', 'value': 'secret-relationship' },
        { 'label': 'Seinen', 'value': 'seinen' },
        { 'label': 'seme protagonist', 'value': 'seme-protagonist' },
        { 'label': 'shonen ai', 'value': 'shonen-ai' },
        { 'label': 'Short Story', 'value': 'short-story' },
        { 'label': 'Shoujo', 'value': 'shoujo' },
        { 'label': 'Shoujo ai', 'value': 'shoujo-ai' },
        { 'label': 'Shounen', 'value': 'shounen' },
        { 'label': 'Shounen ai', 'value': 'shounen-ai' },
        { 'label': 'Showbi', 'value': 'showbi' },
        { 'label': 'showbiz', 'value': 'showbiz' },
        { 'label': 'Slice of Life', 'value': 'slice-of-life' },
        { 'label': 'Slow Romance', 'value': 'slow-romance' },
        { 'label': 'Smut', 'value': 'smut' },
        { 'label': 'soul-swapping', 'value': 'soul-swapping' },
        { 'label': 'Sports', 'value': 'sports' },
        { 'label': 'Stoic Characters', 'value': 'stoic-characters' },
        { 'label': 'Straight Seme', 'value': 'straight-seme' },
        { 'label': 'Straight uke', 'value': 'straight-uke' },
        { 'label': 'Straight- Gay', 'value': 'straight-gay' },
        { 'label': 'Stubborn Protagonist', 'value': 'stubborn-protagonist' },
        { 'label': 'Sugar daddy', 'value': 'sugar-daddy' },
        { 'label': 'Supernatural', 'value': 'supernatural' },
        { 'label': 'suspense', 'value': 'suspense' },
        { 'label': 'System Administrator', 'value': 'system-administrator' },
        { 'label': 'Thriller', 'value': 'thriller' },
        { 'label': 'Time Skip', 'value': 'time-skip' },
        { 'label': 'Time Travel', 'value': 'time-travel' },
        { 'label': 'Tragedy', 'value': 'tragedy' },
        { 'label': 'Tragic Past', 'value': 'tragic-past' },
        { 'label': 'Transmigration', 'value': 'transmigration' },
        { 'label': 'Transplanted Memories', 'value': 'transplanted-memories' },
        { 'label': 'Tsundere', 'value': 'tsundere' },
        { 'label': 'Unconditional Love', 'value': 'unconditional-love' },
        { 'label': 'Unlimited flow', 'value': 'unlimited-flow' },
        { 'label': 'Unrequited Love', 'value': 'unrequited-love' },
        { 'label': 'Urban Life', 'value': 'urban-life' },
        { 'label': 'weak to strong', 'value': 'weak-to-strong' },
        { 'label': 'wealthy characters', 'value': 'wealthy-characters' },
        { 'label': 'Western', 'value': 'western' },
        { 'label': 'work', 'value': 'work' },
        { 'label': 'workplace', 'value': 'workplace' },
        { 'label': 'Writers', 'value': 'writers' },
        { 'label': 'Wu xia', 'value': 'wu-xia' },
        { 'label': 'Wuxia', 'value': 'wuxia' },
        { 'label': 'Xianxia', 'value': 'xianxia' },
        { 'label': 'Xuanhuan', 'value': 'xuanhuan' },
        { 'label': 'Yaoi', 'value': 'yaoi' },
        { 'label': 'Younger love interest', 'value': 'younger-love-interest' },
        {
          'label': 'Younger Love Interests',
          'value': 'younger-love-interests',
        },
        { 'label': 'Yuri', 'value': 'yuri' },
      ],
    },
    'type[]': {
      'type': 'Checkbox',
      'label': 'Type',
      'value': [],
      'options': [
        { 'label': '⁸', 'value': '⁸' },
        { 'label': 'chinese', 'value': 'chinese' },
        { 'label': 'Chinese Novel', 'value': 'chinese-novel' },
        { 'label': 'Cthulhu', 'value': 'cthulhu' },
        { 'label': 'Double AA', 'value': 'double-aa' },
        { 'label': 'historic love', 'value': 'historic-love' },
        { 'label': 'Japanese Novel', 'value': 'japanese-novel' },
        { 'label': 'Kō Randō (藍銅 紅)', 'value': 'ko-rando-藍銅-紅' },
        { 'label': 'Korean Novel', 'value': 'korean-novel' },
        { 'label': 'Light Novel (CN)', 'value': 'light-novel-cn' },
        { 'label': 'Light Novel (JP)', 'value': 'light-novel-jp' },
        { 'label': 'Original Novel', 'value': 'original-novel' },
        { 'label': 'Published Novel', 'value': 'published-novel' },
        { 'label': 'Published Novel (KR)', 'value': 'published-novel-kr' },
        { 'label': 'Quick Transmigration', 'value': 'quick-transmigration' },
        {
          'label':
            'Remove term: Chinese Novel Chinese NovelRemove term: Web Novel Web Novel',
          'value':
            'remove-term-chinese-novel-chinese-novelremove-term-web-novel-web-novel',
        },
        { 'label': 'romance', 'value': 'romance' },
        { 'label': 'Short Story', 'value': 'short-story' },
        { 'label': 'Web Novel', 'value': 'web-novel' },
      ],
    },
    'status': {
      'type': 'Picker',
      'label': 'Status',
      'value': '',
      'options': [
        { 'label': 'All', 'value': '' },
        { 'label': 'Ongoing', 'value': 'ongoing' },
        { 'label': 'Hiatus', 'value': 'hiatus' },
        { 'label': 'Completed', 'value': 'completed' },
      ],
    },
    'order': {
      'type': 'Picker',
      'label': 'Order by',
      'value': '',
      'options': [
        { 'label': 'Default', 'value': '' },
        { 'label': 'A-Z', 'value': 'title' },
        { 'label': 'Z-A', 'value': 'titlereverse' },
        { 'label': 'Latest Update', 'value': 'update' },
        { 'label': 'Latest Added', 'value': 'latest' },
        { 'label': 'Popular', 'value': 'popular' },
      ],
    },
  },
});
export default plugin;
