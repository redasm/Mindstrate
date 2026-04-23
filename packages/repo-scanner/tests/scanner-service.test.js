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
const node_child_process_1 = require("node:child_process");
const server_1 = require("@mindstrate/server");
const scanner_service_js_1 = require("../src/scanner-service.js");
function tmp(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function initRepo(repoPath) {
    (0, node_child_process_1.execSync)('git init', { cwd: repoPath, stdio: 'pipe' });
    (0, node_child_process_1.execSync)('git config user.email "scanner@example.com"', { cwd: repoPath, stdio: 'pipe' });
    (0, node_child_process_1.execSync)('git config user.name "Repo Scanner"', { cwd: repoPath, stdio: 'pipe' });
}
function commitFile(repoPath, file, content, message) {
    fs.writeFileSync(path.join(repoPath, file), content, 'utf8');
    (0, node_child_process_1.execSync)(`git add ${file}`, { cwd: repoPath, stdio: 'pipe' });
    (0, node_child_process_1.execSync)(`git commit -m "${message}"`, { cwd: repoPath, stdio: 'pipe' });
}
(0, vitest_1.describe)('RepoScannerService', () => {
    let repoDir;
    let memoryDir;
    let scannerDir;
    let memory;
    let service;
    (0, vitest_1.beforeEach)(async () => {
        repoDir = tmp('repo-scanner-repo-');
        memoryDir = tmp('repo-scanner-memory-');
        scannerDir = tmp('repo-scanner-db-');
        initRepo(repoDir);
        commitFile(repoDir, 'app.ts', [
            'export function fixUser() {',
            '  const user = getUser();',
            '  if (!user) return null;',
            '  return user.name;',
            '}',
        ].join('\n'), 'fix: handle missing user');
        memory = new server_1.Mindstrate({ dataDir: memoryDir, openaiApiKey: '' });
        await memory.init();
        service = new scanner_service_js_1.RepoScannerService({
            scannerDbPath: path.join(scannerDir, 'scanner.db'),
            memory,
        });
        await service.init();
    });
    (0, vitest_1.afterEach)(async () => {
        await service.close();
        memory.close();
        fs.rmSync(repoDir, { recursive: true, force: true });
        fs.rmSync(memoryDir, { recursive: true, force: true });
        fs.rmSync(scannerDir, { recursive: true, force: true });
    });
    (0, vitest_1.it)('initializes from current head when initMode=from_now', async () => {
        const source = service.addGitLocalSource({
            name: 'repo',
            project: 'proj',
            repoPath: repoDir,
            initMode: 'from_now',
        });
        const result = await service.runSource(source.id);
        (0, vitest_1.expect)(result.mode).toBe('initialized');
        (0, vitest_1.expect)(result.itemsImported).toBe(0);
        (0, vitest_1.expect)(service.store.getSource(source.id)?.lastCursor).toBeTruthy();
    });
    (0, vitest_1.it)('backfills recent commits and writes extracted knowledge', async () => {
        const source = service.addGitLocalSource({
            name: 'repo',
            project: 'proj',
            repoPath: repoDir,
            initMode: 'backfill_recent',
            backfillCount: 5,
        });
        const result = await service.runSource(source.id);
        (0, vitest_1.expect)(result.itemsSeen).toBe(1);
        (0, vitest_1.expect)(result.itemsImported).toBe(1);
        (0, vitest_1.expect)(memory.list()).toHaveLength(1);
        (0, vitest_1.expect)(memory.list()[0].context.project).toBe('proj');
    });
});
//# sourceMappingURL=scanner-service.test.js.map