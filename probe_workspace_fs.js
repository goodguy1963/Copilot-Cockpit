const fs = require('fs');
const path = require('path');
const os = require('os');
const server = require('./out/server.js');

(async () => {
    const tempDir = path.join(os.tmpdir(), 'cockpit-probe-workspace-fs-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    const vscodeDir = path.join(tempDir, '.vscode');
    fs.mkdirSync(vscodeDir);

    // 1. Create .vscode/settings.json - set to FS mode
    fs.writeFileSync(path.join(vscodeDir, 'settings.json'), JSON.stringify({
        "copilotCockpit.storageMode": "fs"
    }, null, 2));

    // 2. Seed .vscode/scheduler.json (simulate migration base)
    const legacyPath = '.vscode/scheduler-prompt-backups/.vscode/cockpit-prompt-backups/demo-task.prompt.md';
    fs.writeFileSync(path.join(vscodeDir, 'scheduler.json'), JSON.stringify({
        tasks: [{
            id: 'demo-task',
            promptBackupPath: legacyPath
        }]
    }, null, 2));

    // 3. Setup data with canonical path
    const canonicalPath = '.vscode/cockpit-prompt-backups/demo-task.prompt.md';
    const newConfig = {
        tasks: [{
            id: 'demo-task',
            name: 'Demo task',
            cron: '15 0 * * *',
            prompt: 'Run the demo loop.',
            enabled: true,
            promptBackupPath: canonicalPath
        }],
        jobs: [],
        jobFolders: [],
        cockpitBoard: { columns: [] }
    };

    console.log('Testing with workspace out/server.js (FS mode)...');
    console.log('Calling writeSchedulerServerConfigForWorkspace (AWAITED)...');
    try {
        await server.writeSchedulerServerConfigForWorkspace(tempDir, newConfig);
    } catch (e) {
        console.error('Call failed:', e);
    }

    const schedulerJsonPath = path.join(vscodeDir, 'scheduler.json');
    const privateJsonPath = path.join(vscodeDir, 'scheduler.private.json');

    if (fs.existsSync(schedulerJsonPath)) {
        const sj = JSON.parse(fs.readFileSync(schedulerJsonPath, 'utf8'));
        console.log('scheduler.json task[0].promptBackupPath: ' + (sj.tasks?.[0]?.promptBackupPath || 'undefined'));
    } else {
        console.log('scheduler.json NOT FOUND');
    }

    if (fs.existsSync(privateJsonPath)) {
        const pj = JSON.parse(fs.readFileSync(privateJsonPath, 'utf8'));
        console.log('scheduler.private.json task[0].promptBackupPath: ' + (pj.tasks?.[0]?.promptBackupPath || 'undefined'));
    } else {
        console.log('scheduler.private.json NOT FOUND');
    }
})();
