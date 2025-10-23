"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.icon = exports.version = exports.site = exports.name = exports.id = void 0;
var fetch_1 = require("@utils/fetch");
var cheerio = __importStar(require("cheerio")); // Інструмент для парсингу HTML
exports.id = 'honeymanga'; // Унікальний ID
exports.name = 'Honey Manga'; // Назва в додатку
exports.site = 'https://honey-manga.com.ua'; // Базовий URL
exports.version = '1.0.0';
exports.icon = 'src/uk/honeymanga/icon.png'; // Шлях до іконки
var pluginId = exports.id;
var HoneyManga = /** @class */ (function () {
    function HoneyManga() {
    }
    // Функція для отримання популярних новел (зі сторінки "comics")
    HoneyManga.prototype.popularNovels = function (page, options) {
        return __awaiter(this, void 0, void 0, function () {
            var url, result, body, $, novels;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        url = "".concat(exports.site, "/comics?page=").concat(page);
                        return [4 /*yield*/, (0, fetch_1.fetchApi)(url)];
                    case 1:
                        result = _a.sent();
                        return [4 /*yield*/, result.text()];
                    case 2:
                        body = _a.sent();
                        $ = cheerio.load(body);
                        novels = [];
                        $('a.flex.flex-col').each(function (i, el) {
                            var novelItem = {
                                name: $(el).find('p.text-sm').text().trim(),
                                path: $(el).attr('href') || '',
                                cover: $(el).find('img').attr('src'),
                            };
                            novels.push(novelItem);
                        });
                        return [2 /*return*/, novels];
                }
            });
        });
    };
    HoneyManga.prototype.searchNovels = function (searchTerm, page) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                return [2 /*return*/, []];
            });
        });
    };
    HoneyManga.prototype.parseNovelAndChapters = function (novelPath) {
        return __awaiter(this, void 0, void 0, function () {
            var url, result, body, $, infoRoot, name, summary, cover, novel;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        url = "".concat(exports.site).concat(novelPath);
                        return [4 /*yield*/, (0, fetch_1.fetchApi)(url)];
                    case 1:
                        result = _a.sent();
                        return [4 /*yield*/, result.text()];
                    case 2:
                        body = _a.sent();
                        $ = cheerio.load(body);
                        infoRoot = $('.md:flex-1.max-md:w-full.max-md:mt-6');
                        name = infoRoot.find('p.font-bold').first().text().trim() ||
                            $('p.font-bold').first().text().trim();
                        summary = $('.MuiTabPanel-root .flex-1 > p.mt-4').first().text().trim() ||
                            $('p.mt-4').first().text().trim();
                        cover = $('.relative.rounded-[4px] img').attr('src');
                        novel = {
                            path: novelPath,
                            name: name,
                            cover: cover,
                            summary: summary,
                            author: '',
                            status: '',
                            chapters: [],
                        };
                        // Парсер списку розділів (глав)
                        $('a.flex.items-start.justify-between.py-4.border-b').each(function (i, el) {
                            var _a;
                            var path = $(el).attr('href') || '';
                            // Увага. p для назви можна уточнити:
                            var name = $(el).find('p.font-medium.text-sm').text().trim();
                            // Для дати вибираємо .mt-3 span
                            var releaseTime = $(el).find('div.mt-3 span').first().text().trim();
                            if (name && path) {
                                (_a = novel.chapters) === null || _a === void 0 ? void 0 : _a.push({ name: name, path: path, releaseTime: releaseTime });
                            }
                        });
                        if (novel.chapters.length > 1) {
                            novel.chapters.reverse();
                        }
                        return [2 /*return*/, novel];
                }
            });
        });
    };
    HoneyManga.prototype.parseChapter = function (chapterPath) {
        return __awaiter(this, void 0, void 0, function () {
            var url, result, body, $, chapterBlocks, images, content;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        url = "".concat(exports.site).concat(chapterPath);
                        return [4 /*yield*/, (0, fetch_1.fetchApi)(url)];
                    case 1:
                        result = _a.sent();
                        return [4 /*yield*/, result.text()];
                    case 2:
                        body = _a.sent();
                        $ = cheerio.load(body);
                        chapterBlocks = $('div.py-[6px]');
                        if (!chapterBlocks.length) {
                            images = $('img');
                            if (images.length > 5) {
                                throw new Error('Помилка: Цей розділ містить зображення (манґу), а не текст.');
                            }
                            throw new Error('Не вдалося завантажити розділ: текст відсутній.');
                        }
                        content = chapterBlocks
                            .map(function (_, el) { return $(el).html(); })
                            .get()
                            .join('<br>');
                        return [2 /*return*/, content];
                }
            });
        });
    };
    HoneyManga.prototype.fetchImage = function (url) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                // Повертає повний шлях, якщо у src залишився / на початку
                if (url && url.startsWith('/')) {
                    return [2 /*return*/, (0, fetch_1.fetchFile)(exports.site + url)];
                }
                return [2 /*return*/, (0, fetch_1.fetchFile)(url)];
            });
        });
    };
    Object.defineProperty(HoneyManga.prototype, "filters", {
        get: function () {
            return [];
        },
        enumerable: false,
        configurable: true
    });
    return HoneyManga;
}());
exports.default = new HoneyManga();
