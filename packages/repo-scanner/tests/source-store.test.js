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
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const source_store_js_1 = require("../src/source-store.js");
function tmpDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-scanner-'));
    return path.join(dir, 'scanner.db');
}
(0, vitest_1.describe)('SourceStore', () => {
    const toClean = [];
    (0, vitest_1.afterEach)(() => {
        for (const file of toClean.splice(0)) {
            fs.rmSync(path.dirname(file), { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)('creates and lists git-local sources', () => {
        const dbPath = tmpDb();
        toClean.push(dbPath);
        const store = new source_store_js_1.SourceStore(dbPath);
        const source = store.createGitLocalSource({
            name: 'app',
            project: 'app',
            repoPath: 'C:\\repo',
        });
        const listed = store.listSources();
        (0, vitest_1.expect)(listed).toHaveLength(1);
        (0, vitest_1.expect)(listed[0].id).toBe(source.id);
        (0, vitest_1.expect)(listed[0].initMode).toBe('from_now');
        store.close();
    });
});
//# sourceMappingURL=source-store.test.js.map