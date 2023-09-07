
import path from 'path';
import nconf from 'nconf';
import winston from 'winston';
import crypto from 'crypto';

import db from '../database';
import posts from '../posts';
import file from '../file';
import batch from '../batch';

const md5 = (filename: crypto.BinaryLike) => crypto.createHash('md5').update(filename).digest('hex');
const _getFullPath = (relativePath: string) => path.resolve(nconf.get('upload_path') as string, relativePath);
const _validatePath = async (relativePaths: string[]) => {
    if (typeof relativePaths === 'string') {
        relativePaths = [relativePaths];
    } else if (!Array.isArray(relativePaths)) {
        throw new Error(`[[error:wrong-parameter-type, relativePaths, ${typeof relativePaths}, array]]`);
    }

    const fullPaths = relativePaths.map(path => _getFullPath(path));
    const exists = await Promise.all(fullPaths.map(async fullPath => file.exists(fullPath)));

    if (!fullPaths.every(fullPath => fullPath.startsWith(nconf.get('upload_path') as string)) || !exists.every(Boolean)) {
        throw new Error('[[error:invalid-path]]');
    }
};


export = function (User: { associateUpload: (uid: string, relativePath: string[] & Float64Array) => Promise<void>;
    deleteUpload: (callerUid: string, uid: string, uploadNames: string[]) => Promise<void>;
    isAdminOrGlobalMod: (arg0: string) => boolean;
    collateUploads: (uid: string, archive: { file: (arg0: string, arg1: { name: string; }) => void; })
    => Promise<void>; }):Promise<void> {
    User.associateUpload = async (uid, relativePath) => {
        await _validatePath(relativePath);
        await Promise.all([
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.sortedSetAdd(`uid:${uid}:uploads`, Date.now(), relativePath),
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.setObjectField(`upload:${md5(relativePath)}`, 'uid', uid),
        ]);
    };

    User.deleteUpload = async function (callerUid, uid, uploadNames) {
        if (typeof uploadNames === 'string') {
            uploadNames = [uploadNames];
        } else if (!Array.isArray(uploadNames)) {
            throw new Error(`[[error:wrong-parameter-type, uploadNames, ${typeof uploadNames}, array]]`);
        }

        await _validatePath(uploadNames);

        const [isUsersUpload, isAdminOrGlobalMod]: boolean[] = await Promise.all([
            // The next line calls a function in a module that has not been updated to TS yet
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
            db.isSortedSetMembers(`uid:${callerUid}:uploads`, uploadNames),
            User.isAdminOrGlobalMod(callerUid),
        ]) as boolean[];
        if (!isAdminOrGlobalMod && !isUsersUpload) {
            throw new Error('[[error:no-privileges]]');
        }

        await batch.processArray(uploadNames, async (uploadNames: string[]) => {
            const fullPaths: string[] = uploadNames.map((path: string) => _getFullPath(path));

            await Promise.all(fullPaths.map(async (fullPath, idx) => {
                winston.verbose(`[user/deleteUpload] Deleting ${uploadNames[idx]}`);
                await Promise.all([
                    file.delete(fullPath),
                    file.delete(file.appendToFileName(fullPath, '-resized')),
                ]);
                await Promise.all([
                    // The next line calls a function in a module that has not been updated to TS yet
                    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,
                    @typescript-eslint/no-unsafe-call */
                    db.sortedSetRemove(`uid:${uid}:uploads`, uploadNames[idx]),
                    // The next line calls a function in a module that has not been updated to TS yet
                    /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,
                     @typescript-eslint/no-unsafe-call */
                    db.delete(`upload:${md5(uploadNames[idx])}`),
                ]);
            }));

            // Dissociate the upload from pids, if any
            // The next line calls a function in a module that has not been updated to TS yet
            /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,
             @typescript-eslint/no-unsafe-call */
            const pids: string[] = await db.getSortedSetsMembers(uploadNames.map(relativePath => `upload:${md5(relativePath)}:pids`)) as string[];
            await Promise.all(pids.map(async idx => Promise.all(
                // The next line calls a function in a module that has not been updated to TS yet
                /* eslint-disable-next-line @typescript-eslint/no-unsafe-member-access,
                @typescript-eslint/no-unsafe-call */
                pids.map(pid => posts.uploads.dissociate(pid, uploadNames[idx]) as string[])
            )));
        }, { batch: 50 });
    };

    User.collateUploads = async function (uid, archive) {
        await batch.processSortedSet(`uid:${uid}:uploads`, (files: string[], next: () => void) => {
            files.forEach((file) => {
                archive.file(_getFullPath(file), {
                    name: path.basename(file),
                });
            });

            setImmediate(next);
        }, { batch: 100 });
    };
    return Promise.resolve();
}
