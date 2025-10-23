import { fetchApi } from '@libs/fetch';
import { Filters } from '@libs/filterInputs';
import { Plugin } from '@/types/plugin';
import { Cheerio, AnyNode, CheerioAPI, load as parseHTML } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import dayjs from 'dayjs';
import { storage } from '@libs/storage';

const includesAny = (str: string, keywords: string[]) =>
  new RegExp(keywords.join('|')).test(str);

type MadaraOptions = {
  useNewChapterEndpoint?: boolean;
  lang?: string;
  orderBy?: string;
  versionIncrements?: number;
  customJs?: string;
  hasLocked?: boolean;
};

export type MadaraMetadata = {
  id: string;
  sourceSite: string;
  sourceName: string;
  options?: MadaraOptions;
  filters?: any;
};

class MadaraPlugin implements Plugin.PluginBase {
  id: string;
  name: string;
  icon: string;
  site: string;
  version: string;
  options?: MadaraOptions;
  filters?: Filters | undefined;

  hideLocked = storage.get('hideLocked');
  pluginSettings?: Record<string, any>;

  constructor(metadata: MadaraMetadata) {
    this.id = metadata.id;
    this.name = metadata.sourceName;
    this.icon = `multisrc/madara/${metadata.id.toLowerCase()}/icon.png`;
    this.site = metadata.sourceSite;
    const versionIncrements = metadata.options?.versionIncrements || 0;
    this.version = `1.0.${8 + versionIncrements}`;
    this.options = metadata.options;
    this.filters = metadata.filters;

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

  translateDragontea(text: Cheerio<AnyNode>): Cheerio<AnyNode> {
    if (this.id !== 'dragontea') return text;

    const $ = parseHTML(
      text
        .html()
        ?.replace('\n', '')
        .replace(/<br\s*\/?>/g, '\n') || '',
    );
    const reverseAlpha = 'zyxwvutsrqponmlkjihgfedcbaZYXWVUTSRQPONMLKJIHGFEDCBA';
    const forwardAlpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

    text.html($.html());
    text
      .find('*')
      .addBack()
      .contents()
      .filter((_, el) => el.nodeType === 3)
      .each((_, el) => {
        const $el = $(el);
        const translated = $el
          .text()
          .normalize('NFD')
          .split('')
          .map(char => {
            const base = char.normalize('NFC');
            const idx = forwardAlpha.indexOf(base);
            return idx >= 0
              ? reverseAlpha[idx] + char.slice(base.length)
              : char;
          })
          .join('');
        $el.replaceWith(translated.replace('\n', '<br>'));
      });

    return text;
  }

  getHostname(url: string): string {
    url = url.split('/')[2];
    const url_parts = url.split('.');
    url_parts.pop(); // remove TLD
    return url_parts.join('.');
  }

  async getCheerio(url: string, search: boolean): Promise<CheerioAPI> {
    const r = await fetchApi(url);
    if (!r.ok && search != true)
      throw new Error(
        'Could not reach site (' + r.status + ') try to open in webview.',
      );
    const $ = parseHTML(await r.text());
    const title = $('title').text().trim();
    if (
      this.getHostname(url) != this.getHostname(r.url) ||
      title == 'Bot Verification' ||
      title == 'You are being redirected...' ||
      title == 'Un instant...' ||
      title == 'Just a moment...' ||
      title == 'Redirecting...'
    )
      throw new Error('Captcha error, please open in webview');
    return $;
  }

  parseNovels(loadedCheerio: CheerioAPI): Plugin.NovelItem[] {
    const novels: Plugin.NovelItem[] = [];

    loadedCheerio('.manga-title-badges').remove();

    loadedCheerio('.page-item-detail, .c-tabs-item__content').each(
      (index, element) => {
        const novelName = loadedCheerio(element)
          .find('.post-title')
          .text()
          .trim();
        const novelUrl =
          loadedCheerio(element).find('.post-title').find('a').attr('href') ||
          '';
        if (!novelName || !novelUrl) return;
        const image = loadedCheerio(element).find('img');
        const novelCover =
          image.attr('data-src') ||
          image.attr('src') ||
          image.attr('data-lazy-srcset') ||
          defaultCover;
        const novel: Plugin.NovelItem = {
          name: novelName,
          cover: novelCover,
          path: novelUrl.replace(/https?:\/\/.*?\//, '/'),
        };
        novels.push(novel);
      },
    );

    return novels;
  }

  async popularNovels(
    pageNo: number,
    {
      filters,
      showLatestNovels,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    let url = this.site + '/page/' + pageNo + '/?s=&post_type=wp-manga';
    if (!filters) filters = this.filters || {};
    if (showLatestNovels) url += '&m_orderby=latest';
    for (const key in filters) {
      if (typeof filters[key].value === 'object')
        for (const value of filters[key].value as string[])
          url += `&${key}=${value}`;
      else if (filters[key].value) url += `&${key}=${filters[key].value}`;
    }
    const loadedCheerio = await this.getCheerio(url, pageNo != 1);
    return this.parseNovels(loadedCheerio);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    let loadedCheerio = await this.getCheerio(this.site + novelPath, false);

    loadedCheerio('.manga-title-badges, #manga-title span').remove();
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name:
        loadedCheerio('.post-title h1').text().trim() ||
        loadedCheerio('#manga-title h1').text().trim() ||
        loadedCheerio('.manga-title').text().trim() ||
        '',
    };

    novel.cover =
      loadedCheerio('.summary_image > a > img').attr('data-lazy-src') ||
      loadedCheerio('.summary_image > a > img').attr('data-src') ||
      loadedCheerio('.summary_image > a > img').attr('src') ||
      defaultCover;

    loadedCheerio('.post-content_item, .post-content').each(function () {
      const detailName = loadedCheerio(this).find('h5').text().trim();
      const detail =
        loadedCheerio(this).find('.summary-content') ||
        loadedCheerio(this).find('.summary_content');

      switch (detailName) {
        case 'Genre(s)':
        case 'Genre':
        case 'Tags(s)':
        case 'Tag(s)':
        case 'Tags':
        case 'Género(s)':
        case 'Kategori':
        case 'التصنيفات':
          if (novel.genres)
            novel.genres +=
              ', ' +
              detail
                .find('a')
                .map((i, el) => loadedCheerio(el).text())
                .get()
                .join(', ');
          else
            novel.genres = detail
              .find('a')
              .map((i, el) => loadedCheerio(el).text())
              .get()
              .join(', ');
          break;
        case 'Author(s)':
        case 'Author':
        case 'Autor(es)':
        case 'المؤلف':
        case 'المؤلف (ين)':
          novel.author = detail.text().trim();
          break;
        case 'Status':
        case 'Novel':
        case 'Estado':
        case 'Durum':
          novel.status =
            detail.text().trim().includes('OnGoing') ||
            detail.text().trim().includes('مستمرة')
              ? NovelStatus.Ongoing
              : NovelStatus.Completed;
          break;
        case 'Artist(s)':
          novel.artist = detail.text().trim();
          break;
      }
    });

    // Checks for "Madara NovelHub" version
    {
      if (!novel.genres)
        novel.genres = loadedCheerio('.genres-content').text().trim();
      if (!novel.status)
        novel.status = loadedCheerio('.manga-status')
          .text()
          .trim()
          .includes('OnGoing')
          ? NovelStatus.Ongoing
          : NovelStatus.Completed;
      if (!novel.author)
        novel.author = loadedCheerio('.manga-author a').text().trim();
      if (!novel.rating)
        novel.rating = parseFloat(
          loadedCheerio('.post-rating span').text().trim(),
        );
    }

    if (!novel.author)
      novel.author = loadedCheerio('.manga-authors').text().trim();

    loadedCheerio('div.summary__content .code-block,script,noscript').remove();
    novel.summary =
      this.translateDragontea(loadedCheerio('div.summary__content'))
        .text()
        .trim() ||
      loadedCheerio('#tab-manga-about').text().trim() ||
      loadedCheerio('.post-content_item h5:contains("Summary")')
        .next()
        .find('span')
        .map((i, el) => loadedCheerio(el).text())
        .get()
        .join('\n\n')
        .trim() ||
      loadedCheerio('.manga-summary p')
        .map((i, el) => loadedCheerio(el).text())
        .get()
        .join('\n\n')
        .trim() ||
      loadedCheerio('.manga-excerpt p')
        .map((i, el) => loadedCheerio(el).text())
        .get()
        .join('\n\n')
        .trim();
    const chapters: Plugin.ChapterItem[] = [];
    let html = '';

    if (this.options?.useNewChapterEndpoint) {
      html = await fetchApi(this.site + novelPath + 'ajax/chapters/', {
        method: 'POST',
        referrer: this.site + novelPath,
      }).then(res => res.text());
    } else {
      const novelId =
        loadedCheerio('.rating-post-id').attr('value') ||
        loadedCheerio('#manga-chapters-holder').attr('data-id') ||
        '';

      const formData = new FormData();
      formData.append('action', 'manga_get_chapters');
      formData.append('manga', novelId);

      html = await fetchApi(this.site + 'wp-admin/admin-ajax.php', {
        method: 'POST',
        body: formData,
      }).then(res => res.text());
    }

    if (html !== '0') {
      loadedCheerio = parseHTML(html);
    }

    const totalChapters = loadedCheerio('.wp-manga-chapter').length;
    loadedCheerio('.wp-manga-chapter').each((chapterIndex, element) => {
      let chapterName = loadedCheerio(element).find('a').text().trim();
      const locked = element.attribs['class'].includes('premium-block');
      if (locked) {
        chapterName = '🔒 ' + chapterName;
      }

      let releaseDate = loadedCheerio(element)
        .find('span.chapter-release-date')
        .text()
        .trim();

      if (releaseDate) {
        releaseDate = this.parseData(releaseDate);
      } else {
        releaseDate = dayjs().format('LL');
      }

      const chapterUrl = loadedCheerio(element).find('a').attr('href') || '';

      if (chapterUrl && chapterUrl != '#' && !(locked && this.hideLocked)) {
        chapters.push({
          name: chapterName,
          path: chapterUrl.replace(/https?:\/\/.*?\//, '/'),
          releaseTime: releaseDate || null,
          chapterNumber: totalChapters - chapterIndex,
        });
      }
    });

    novel.chapters = chapters.reverse();
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const loadedCheerio = await this.getCheerio(this.site + chapterPath, false);
    const chapterText =
      loadedCheerio('.text-left') ||
      loadedCheerio('.text-right') ||
      loadedCheerio('.entry-content') ||
      loadedCheerio('.c-blog-post > div > div:nth-child(2)');

    if (this.options?.customJs) {
      try {
      } catch (error) {
        console.error('Error executing customJs:', error);
        throw error;
      }
    }

    return this.translateDragontea(chapterText).html() || '';
  }

  async searchNovels(
    searchTerm: string,
    pageNo?: number | undefined,
  ): Promise<Plugin.NovelItem[]> {
    const url =
      this.site +
      '/page/' +
      pageNo +
      '/?s=' +
      encodeURIComponent(searchTerm) +
      '&post_type=wp-manga';
    const loadedCheerio = await this.getCheerio(url, true);
    return this.parseNovels(loadedCheerio);
  }

  parseData = (date: string) => {
    let dayJSDate = dayjs(); // today
    const timeAgo = date.match(/\d+/)?.[0] || '';
    const timeAgoInt = parseInt(timeAgo, 10);

    if (!timeAgo) return date; // there is no number!

    if (includesAny(date, ['detik', 'segundo', 'second', 'วินาที'])) {
      dayJSDate = dayJSDate.subtract(timeAgoInt, 'second'); // go back N seconds
    } else if (
      includesAny(date, [
        'menit',
        'dakika',
        'min',
        'minute',
        'minuto',
        'นาที',
        'دقائق',
      ])
    ) {
      dayJSDate = dayJSDate.subtract(timeAgoInt, 'minute'); // go back N minute
    } else if (
      includesAny(date, [
        'jam',
        'saat',
        'heure',
        'hora',
        'hour',
        'ชั่วโมง',
        'giờ',
        'ore',
        'ساعة',
        '小时',
      ])
    ) {
      dayJSDate = dayJSDate.subtract(timeAgoInt, 'hours'); // go back N hours
    } else if (
      includesAny(date, [
        'hari',
        'gün',
        'jour',
        'día',
        'dia',
        'day',
        'วัน',
        'ngày',
        'giorni',
        'أيام',
        '天',
      ])
    ) {
      dayJSDate = dayJSDate.subtract(timeAgoInt, 'days'); // go back N days
    } else if (includesAny(date, ['week', 'semana'])) {
      dayJSDate = dayJSDate.subtract(timeAgoInt, 'week'); // go back N a week
    } else if (includesAny(date, ['month', 'mes'])) {
      dayJSDate = dayJSDate.subtract(timeAgoInt, 'month'); // go back N months
    } else if (includesAny(date, ['year', 'año'])) {
      dayJSDate = dayJSDate.subtract(timeAgoInt, 'year'); // go back N years
    } else {
      if (dayjs(date).format('LL') !== 'Invalid Date') {
        return dayjs(date).format('LL');
      }
      return date;
    }

    return dayJSDate.format('LL');
  };
}

const plugin = new MadaraPlugin({
  'id': 'olaoe',
  'sourceSite': 'https://olaoe.cyou/',
  'sourceName': 'Olaoe.cyou',
  'options': { 'useNewChapterEndpoint': true, 'lang': 'Arabic' },
  'filters': {
    'genre[]': {
      'type': 'Checkbox',
      'label': 'Genre',
      'value': [],
      'options': [
        { 'label': '+13', 'value': '13' },
        { 'label': '+16', 'value': '16' },
        { 'label': '+17', 'value': '17' },
        { 'label': 'Custom Genre 1', 'value': 'custom-genre-1' },
        { 'label': 'Custom Genre 2', 'value': 'custom-genre-2' },
        { 'label': 'Custom Genre 3', 'value': 'custom-genre-3' },
        { 'label': 'أكشن', 'value': 'أكشن' },
        { 'label': 'إثارة', 'value': 'إثارة' },
        { 'label': 'إعادة إحياء', 'value': 'إعادة-إحياء' },
        { 'label': 'إنتقام', 'value': 'إنتقام' },
        { 'label': 'إيتشي', 'value': 'إيتشي' },
        { 'label': 'اثارة', 'value': 'اثارة' },
        { 'label': 'اثاره', 'value': 'اثاره' },
        { 'label': 'اساطير', 'value': 'اساطير' },
        { 'label': 'اشباح', 'value': 'اشباح' },
        { 'label': 'اضطهاد', 'value': 'اضطهاد' },
        { 'label': 'اعادة احياء', 'value': 'اعادة-احياء' },
        { 'label': 'اعاده بحث', 'value': 'اعاده-بحث' },
        { 'label': 'اقتباس مانجا', 'value': 'اقتباس-مانجا' },
        { 'label': 'اقتباس مانهوا', 'value': 'اقتباس-مانهوا' },
        { 'label': 'اقتباس مانهوا', 'value': 'اقتباس-مانهوا-انمي' },
        { 'label': 'اكشن', 'value': 'اكشن' },
        { 'label': 'الحياة المدرسيه', 'value': 'الحياة-المدرسيه' },
        { 'label': 'الحياة اليومية', 'value': 'الحياة-اليومية' },
        { 'label': 'السفر عبر الزمن', 'value': 'السفر-عبر-الزمن' },
        { 'label': 'العاب', 'value': 'العاب' },
        { 'label': 'العاب الكترونية', 'value': 'العاب-الكترونية' },
        { 'label': 'العاب فيديو', 'value': 'العاب-فيديو' },
        { 'label': 'النجاة', 'value': 'النجاة' },
        { 'label': 'الهة', 'value': 'الهة' },
        { 'label': 'الهه', 'value': 'الهه' },
        { 'label': 'الواقع الافتراضي', 'value': 'الواقع-الافتراضي' },
        { 'label': 'امرأة شريرة', 'value': 'امرأة-شريرة' },
        { 'label': 'انتقام', 'value': 'انتقام' },
        { 'label': 'انمي', 'value': 'انمي' },
        { 'label': 'انمي ياباني', 'value': 'انمي-ياباني' },
        { 'label': 'ايتشى', 'value': 'ايتشى' },
        { 'label': 'ايتشي', 'value': 'ايتشي' },
        { 'label': 'ايسكاى', 'value': 'ايسكاى' },
        { 'label': 'بالغ', 'value': 'بالغ' },
        { 'label': 'بطل خارق', 'value': 'بطل-خارق' },
        { 'label': 'بطل غير اعتيادي', 'value': 'بطل-غير-اعتيادي' },
        { 'label': 'بوليسي', 'value': 'بوليسي' },
        { 'label': 'تاريخى', 'value': 'تاريخى' },
        { 'label': 'تاريخي', 'value': 'تاريخي' },
        { 'label': 'تجسيد', 'value': 'تجسيد' },
        { 'label': 'تحقيق', 'value': 'تحقيق' },
        { 'label': 'تراجيدي', 'value': 'تراجيدي' },
        { 'label': 'ترجمة جوجل', 'value': 'ترجمة-جوجل' },
        { 'label': 'تشويق', 'value': 'تشويق' },
        { 'label': 'تناسخ', 'value': 'تناسخ' },
        { 'label': 'تناسخ الارواح', 'value': 'تناسخ-الارواح' },
        { 'label': 'جريمة', 'value': 'جريمة' },
        { 'label': 'جريمه', 'value': 'جريمه' },
        { 'label': 'جندر اسواب', 'value': 'جندر-اسواب' },
        { 'label': 'جوسى', 'value': 'جوسى' },
        { 'label': 'جوسي', 'value': 'جوسي' },
        { 'label': 'جوسيه', 'value': 'جوسيه' },
        { 'label': 'حائز على جائزة', 'value': 'حائز-على-جائزة' },
        { 'label': 'حائز علي جائزة', 'value': 'حائز-علي-جائزة' },
        { 'label': 'حديث', 'value': 'حديث' },
        { 'label': 'حربى', 'value': 'حربى' },
        { 'label': 'حربي', 'value': 'حربي' },
        { 'label': 'حريم', 'value': 'حريم' },
        { 'label': 'حياة', 'value': 'حياة' },
        { 'label': 'حياة مدرسية', 'value': 'حياة-مدرسية' },
        { 'label': 'حياة يومية', 'value': 'حياة-يومية' },
        { 'label': 'خارق', 'value': 'خارق' },
        { 'label': 'خارق لطبيعية', 'value': 'خارق-لطبيعية' },
        { 'label': 'خارق للطبيعة', 'value': 'خارق-للطبيعة' },
        { 'label': 'خارق للطبيعه', 'value': 'خارق-للطبيعه' },
        { 'label': 'خارق للعادة', 'value': 'خارق-للعادة' },
        { 'label': 'خيال', 'value': 'خيال' },
        { 'label': 'خيال علمى', 'value': 'خيال-علمى' },
        { 'label': 'خيال علمي', 'value': 'خيال-علمي' },
        { 'label': 'خيالي', 'value': 'خيالي' },
        { 'label': 'دراما', 'value': 'دراما' },
        { 'label': 'دماء', 'value': 'دماء' },
        { 'label': 'دموى', 'value': 'دموى' },
        { 'label': 'راشد', 'value': 'راشد' },
        { 'label': 'رعب', 'value': 'رعب' },
        { 'label': 'رواية خفيفة', 'value': 'رواية-خفيفة' },
        { 'label': 'رومانسى', 'value': 'رومانسى' },
        { 'label': 'رومانسي', 'value': 'رومانسي' },
        { 'label': 'رياضة', 'value': 'رياضة' },
        { 'label': 'رياضه', 'value': 'رياضه' },
        { 'label': 'رياضى', 'value': 'رياضى' },
        { 'label': 'رياضي', 'value': 'رياضي' },
        { 'label': 'زراعة', 'value': 'زراعة' },
        { 'label': 'زمكانى', 'value': 'زمكانى' },
        { 'label': 'زمكاني', 'value': 'زمكاني' },
        { 'label': 'زمنكاني', 'value': 'زمنكاني' },
        { 'label': 'زومبي', 'value': 'زومبي' },
        { 'label': 'ساخر', 'value': 'ساخر' },
        { 'label': 'ساموراي', 'value': 'ساموراي' },
        { 'label': 'سباق', 'value': 'سباق' },
        { 'label': 'سحر', 'value': 'سحر' },
        { 'label': 'سينين', 'value': 'سينين' },
        { 'label': 'شرطة', 'value': 'شرطة' },
        { 'label': 'شريحة من الحياة', 'value': 'شريحة-من-الحياة' },
        { 'label': 'شرير', 'value': 'شرير' },
        { 'label': 'شوجو', 'value': 'شوجو' },
        { 'label': 'شونين', 'value': 'شونين' },
        { 'label': 'شياطين', 'value': 'شياطين' },
        { 'label': 'صقل', 'value': 'صقل' },
        { 'label': 'طبخ', 'value': 'طبخ' },
        { 'label': 'ّعامل مكتبي', 'value': 'ّعامل-مكتبي' },
        { 'label': 'عسكري', 'value': 'عسكري' },
        { 'label': 'عسكريه', 'value': 'عسكريه' },
        { 'label': 'علم نفس', 'value': 'علم-نفس' },
        { 'label': 'عنف', 'value': 'عنف' },
        { 'label': 'غموض', 'value': 'غموض' },
        { 'label': 'فضاء', 'value': 'فضاء' },
        { 'label': 'فلسفه', 'value': 'فلسفه' },
        { 'label': 'فلم انمي', 'value': 'فلم-انمي' },
        { 'label': 'فنتازيا', 'value': 'فنتازيا' },
        { 'label': 'فنون قتال', 'value': 'فنون-قتال' },
        { 'label': 'فنون قتالية', 'value': 'فنون-قتالية' },
        { 'label': 'فنون قتاليه', 'value': 'فنون-قتاليه' },
        { 'label': 'قتال', 'value': 'قتال' },
        { 'label': 'قوة خارقة', 'value': 'قوة-خارقة' },
        { 'label': 'قوى خارقة', 'value': 'قوى-خارقة' },
        { 'label': 'كومديا', 'value': 'كومديا' },
        { 'label': 'كوميدى', 'value': 'كوميدى' },
        { 'label': 'كوميدي', 'value': 'كوميدي' },
        { 'label': 'كوميديا', 'value': 'كوميديا' },
        { 'label': 'لعبة', 'value': 'لعبة' },
        { 'label': 'لعبه', 'value': 'لعبه' },
        { 'label': 'مأساة', 'value': 'مأساة' },
        { 'label': 'ماساة', 'value': 'ماساة' },
        { 'label': 'مافيا', 'value': 'مافيا' },
        { 'label': 'مانجا', 'value': 'مانجا' },
        { 'label': 'مانجا على الانترنت', 'value': 'مانجا-على-الانترنت' },
        { 'label': 'مانها', 'value': 'مانها' },
        { 'label': 'مانهوا', 'value': 'مانهوا' },
        { 'label': 'مجموعة قصص', 'value': 'مجموعة-قصص' },
        { 'label': 'محاكاة ساخرة', 'value': 'محاكاة-ساخرة' },
        { 'label': 'مدرسه', 'value': 'مدرسه' },
        { 'label': 'مدرسي', 'value': 'مدرسي' },
        { 'label': 'مصاصى الدماء', 'value': 'مصاصى-الدماء' },
        { 'label': 'مصاصي دماء', 'value': 'مصاصي-دماء' },
        { 'label': 'مغامرات', 'value': 'مغامرات' },
        { 'label': 'مغامرة', 'value': 'مغامرة' },
        { 'label': 'مقتبسة', 'value': 'مقتبسة' },
        { 'label': 'موريم', 'value': 'موريم' },
        { 'label': 'موسيقى', 'value': 'موسيقى' },
        { 'label': 'موسيقي', 'value': 'موسيقي' },
        { 'label': 'ميكا', 'value': 'ميكا' },
        { 'label': 'ناضج', 'value': 'ناضج' },
        { 'label': 'نظام', 'value': 'نظام' },
        { 'label': 'نفسى', 'value': 'نفسى' },
        { 'label': 'نفسي', 'value': 'نفسي' },
        { 'label': 'نينجا', 'value': 'نينجا' },
        { 'label': 'وحوش', 'value': 'وحوش' },
        { 'label': 'ويب تون', 'value': 'ويب-تون' },
      ],
    },
    'op': {
      'type': 'Switch',
      'label': 'having all selected genres',
      'value': false,
    },
    'author': { 'type': 'Text', 'label': 'Author', 'value': '' },
    'artist': { 'type': 'Text', 'label': 'Artist', 'value': '' },
    'release': { 'type': 'Text', 'label': 'Year of Released', 'value': '' },
    'adult': {
      'type': 'Picker',
      'label': 'Adult content',
      'value': '',
      'options': [
        { 'label': 'All', 'value': '' },
        { 'label': 'None adult content', 'value': '0' },
        { 'label': 'Only adult content', 'value': '1' },
      ],
    },
    'status[]': {
      'type': 'Checkbox',
      'label': 'Status',
      'value': [],
      'options': [
        { 'label': 'مستمر', 'value': 'on-going' },
        { 'label': 'مكتمل', 'value': 'end' },
        { 'label': 'ملغى', 'value': 'canceled' },
        { 'label': 'في الانتظار', 'value': 'on-hold' },
        { 'label': 'قادم قريبا', 'value': 'upcoming' },
      ],
    },
    'm_orderby': {
      'type': 'Picker',
      'label': 'Order by',
      'value': '',
      'options': [
        { 'label': 'Relevance', 'value': '' },
        { 'label': 'Latest', 'value': 'latest' },
        { 'label': 'A-Z', 'value': 'alphabet' },
        { 'label': 'Rating', 'value': 'rating' },
        { 'label': 'Trending', 'value': 'trending' },
        { 'label': 'Most Views', 'value': 'views' },
        { 'label': 'New', 'value': 'new-manga' },
      ],
    },
  },
});
export default plugin;
