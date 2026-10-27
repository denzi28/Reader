// Makes "Leafpage" appear in Android's "Open with" list for PDF and ePub files.
//
// Bubblewrap reads `file_handlers` from the web manifest but does not turn them into the Android intent filter
// that "Open with" needs, so this adds it to the generated project, between `bubblewrap update` and `bubblewrap build`.
// The Trusted Web Activity library then hands the opened file to the page, which receives it through
// `launchQueue` (src/lib/pwa.ts) and asks whether to save it to the library.
//
// Usage: node add-file-intents.mjs [path to app/src/main/AndroidManifest.xml]
import fs from 'node:fs';

const file = process.argv[2] ?? 'app/src/main/AndroidManifest.xml';
const xml = fs.readFileSync(file, 'utf8');

if (xml.includes('leafpage-open-with')) {
  console.log('Open-with filter already there.');
  process.exit(0);
}

const FILTER = `
            <!-- leafpage-open-with: a PDF or ePub opened from a file manager or another app -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <data android:scheme="content"/>
                <data android:scheme="file"/>
                <data android:mimeType="application/pdf"/>
                <data android:mimeType="application/epub+zip"/>
            </intent-filter>
`;

// The filter goes at the end of the launcher activity, the one that starts the Trusted Web Activity.
const start = xml.search(/<activity\s+android:name="(?:[\w.]*\.)?LauncherActivity"/);
if (start < 0) throw new Error('The launcher activity was not found in ' + file);
const end = xml.indexOf('</activity>', start);
if (end < 0) throw new Error('The launcher activity is not closed in ' + file);

fs.writeFileSync(file, xml.slice(0, end) + FILTER + '        ' + xml.slice(end));
console.log('Added the open-with filter to ' + file);
