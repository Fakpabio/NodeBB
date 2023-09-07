"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const path_1 = __importDefault(require("path"));
const nconf_1 = __importDefault(require("nconf"));
const winston_1 = __importDefault(require("winston"));
const crypto_1 = __importDefault(require("crypto"));
const database_1 = __importDefault(require("../database"));
const posts_1 = __importDefault(require("../posts"));
const file_1 = __importDefault(require("../file"));
const batch_1 = __importDefault(require("../batch"));
const md5 = (filename) => crypto_1.default.createHash('md5').update(filename).digest('hex');
const _getFullPath = (relativePath) => path_1.default.resolve(nconf_1.default.get('upload_path'), relativePath);
const _validatePath = (relativePaths) => __awaiter(void 0, void 0, void 0, function* () {
    if (typeof relativePaths === 'string') {
        relativePaths = [relativePaths];
    }
    else if (!Array.isArray(relativePaths)) {
        throw new Error(`[[error:wrong-parameter-type, relativePaths, ${typeof relativePaths}, array]]`);
    }
    const fullPaths = relativePaths.map(path => _getFullPath(path));
    const exists = yield Promise.all(fullPaths.map((fullPath) => __awaiter(void 0, void 0, void 0, function* () { return file_1.default.exists(fullPath); })));
    if (!fullPaths.every(fullPath => fullPath.startsWith(nconf_1.default.get('upload_path'))) || !exists.every(Boolean)) {
        throw new Error('[[error:invalid-path]]');
    }
});
module.exports = function (User) {
    User.associateUpload = (uid, relativePath) => __awaiter(this, void 0, void 0, function* () {
        yield _validatePath(relativePath);
        yield Promise.all([
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            database_1.default.sortedSetAdd(`uid:${uid}:uploads`, Date.now(), relativePath),
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            database_1.default.setObjectField(`upload:${md5(relativePath)}`, 'uid', uid),
        ]);
    });
    User.deleteUpload = function (callerUid, uid, uploadNames) {
        return __awaiter(this, void 0, void 0, function* () {
            if (typeof uploadNames === 'string') {
                uploadNames = [uploadNames];
            }
            else if (!Array.isArray(uploadNames)) {
                throw new Error(`[[error:wrong-parameter-type, uploadNames, ${typeof uploadNames}, array]]`);
            }
            yield _validatePath(uploadNames);
            const [isUsersUpload, isAdminOrGlobalMod] = yield Promise.all([
                // The next line calls a function in a module that has not been updated to TS yet
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                database_1.default.isSortedSetMembers(`uid:${callerUid}:uploads`, uploadNames),
                User.isAdminOrGlobalMod(callerUid),
            ]);
            if (!isAdminOrGlobalMod && !isUsersUpload) {
                throw new Error('[[error:no-privileges]]');
            }
            yield batch_1.default.processArray(uploadNames, (uploadNames) => __awaiter(this, void 0, void 0, function* () {
                const fullPaths = uploadNames.map((path) => _getFullPath(path));
                yield Promise.all(fullPaths.map((fullPath, idx) => __awaiter(this, void 0, void 0, function* () {
                    winston_1.default.verbose(`[user/deleteUpload] Deleting ${uploadNames[idx]}`);
                    yield Promise.all([
                        file_1.default.delete(fullPath),
                        file_1.default.delete(file_1.default.appendToFileName(fullPath, '-resized')),
                    ]);
                    yield Promise.all([
                        // The next line calls a function in a module that has not been updated to TS yet
                        /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,
                        @typescript-eslint/no-unsafe-call */
                        database_1.default.sortedSetRemove(`uid:${uid}:uploads`, uploadNames[idx]),
                        // The next line calls a function in a module that has not been updated to TS yet
                        /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,
                         @typescript-eslint/no-unsafe-call */
                        database_1.default.delete(`upload:${md5(uploadNames[idx])}`),
                    ]);
                })));
                // Dissociate the upload from pids, if any
                // The next line calls a function in a module that has not been updated to TS yet
                /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,
                 @typescript-eslint/no-unsafe-call */
                const pids = yield database_1.default.getSortedSetsMembers(uploadNames.map(relativePath => `upload:${md5(relativePath)}:pids`));
                yield Promise.all(pids.map((idx) => __awaiter(this, void 0, void 0, function* () {
                    return Promise.all(
                    // The next line calls a function in a module that has not been updated to TS yet
                    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,
                    @typescript-eslint/no-unsafe-call */
                    pids.map(pid => posts_1.default.uploads.dissociate(pid, uploadNames[idx])));
                })));
            }), { batch: 50 });
        });
    };
    User.collateUploads = function (uid, archive) {
        return __awaiter(this, void 0, void 0, function* () {
            yield batch_1.default.processSortedSet(`uid:${uid}:uploads`, (files, next) => {
                files.forEach((file) => {
                    archive.file(_getFullPath(file), {
                        name: path_1.default.basename(file),
                    });
                });
                setImmediate(next);
            }, { batch: 100 });
        });
    };
    return Promise.resolve();
};
