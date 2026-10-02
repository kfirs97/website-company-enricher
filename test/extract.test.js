import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySocial, cleanEmail, decodeCfEmail, extractPage, mergePages, nameFromTitle, normalizePhone, pickContactPages } from '../src/extract.js';

const HOME = `<!doctype html><html lang="en-US"><head>
<title>Home | Acme Robotics</title>
<meta name="description" content="Industrial robots for small factories.">
<meta property="og:site_name" content="Acme Robotics">
<meta property="og:image" content="/img/banner.jpg">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"WebSite","name":"Acme site"},
  {"@type":"Organization","name":"Acme Robotics Ltd.","logo":{"@type":"ImageObject","url":"https://acme.test/logo.svg"},
   "sameAs":["https://www.linkedin.com/company/acme-robotics/","https://github.com/acme"],
   "address":{"@type":"PostalAddress","streetAddress":"1 Main St","addressLocality":"Haifa","postalCode":"3100001","addressCountry":"IL"},
   "contactPoint":{"@type":"ContactPoint","telephone":"+972-4-555-1234","email":"sales@acme.test"}}]}</script>
<script>var sentry="3f9a1b2c3d4e5f60718293a4b5c6d7e8@o1.ingest.sentry.io"; var x="a@b.png";</script>
</head><body>
<a href="mailto:Info@Acme.test?subject=Hi">Email us</a>
<a href="tel:+1 (555) 010-2000">Call</a>
<a href="https://twitter.com/acmerobotics">Twitter</a>
<a href="https://twitter.com/intent/tweet?text=hi">Share</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
<a href="https://www.facebook.com/AcmeRobotics/">Facebook</a>
<a href="https://www.instagram.com/p/Cxyz/">A post</a>
<a href="https://instagram.com/acme.robotics">Instagram</a>
<a href="https://www.youtube.com/@acmerobotics">YouTube</a>
<a href="https://wa.me/972501234567">WhatsApp</a>
<a href="/contact-us">Contact</a><a href="/about">About us</a><a href="/blog/2024/a-very-long-post">Blog</a>
<a href="https://other.test/contact">Partner contact</a>
<img src="logo@2x.png">
<p>Write to <b>help@acme.test</b>to get help. <a href="/signup?plan=contact">Contact sales: sign up</a></p><p>Press: press [at] acme [dot] test · Jobs: jobs@acme.test · placeholder you@example.com</p>
<span class="__cf_email__" data-cfemail="${cf('support@acme.test')}">[email protected]</span>
</body></html>`;

function cf(email, key = 0x42) {
  return [key, ...[...email].map(c => c.charCodeAt(0) ^ key)].map(b => b.toString(16).padStart(2, '0')).join('');
}

test('extracts emails from mailto, text, obfuscation, Cloudflare protection and JSON-LD, ignoring junk', () => {
  const p = extractPage(HOME, 'https://acme.test/');
  assert.ok(!p.emails.some(e => e.endsWith('.testto')), 'no glued text');
  for (const e of ['help@acme.test', 'info@acme.test', 'press@acme.test', 'jobs@acme.test', 'support@acme.test', 'sales@acme.test']) assert.ok(p.emails.includes(e), `${e} in ${p.emails}`);
  for (const bad of ['you@example.com', 'a@b.png']) assert.ok(!p.emails.includes(bad), `${bad} excluded`);
  assert.ok(!p.emails.some(e => e.includes('sentry')), 'sentry key excluded');
});

test('extracts phones from tel: links and structured data', () => {
  const p = extractPage(HOME, 'https://acme.test/');
  assert.deepEqual(p.phones.sort(), ['+15550102000', '+97245551234'].sort());
});

test('extracts social profiles and skips share/intent/post links', () => {
  const p = extractPage(HOME, 'https://acme.test/');
  assert.deepEqual(p.socials.twitter, ['https://x.com/acmerobotics']);
  assert.deepEqual(p.socials.facebook, ['https://www.facebook.com/AcmeRobotics']);
  assert.deepEqual(p.socials.instagram, ['https://www.instagram.com/acme.robotics']);
  assert.deepEqual(p.socials.linkedin, ['https://www.linkedin.com/company/acme-robotics']);
  assert.deepEqual(p.socials.youtube, ['https://www.youtube.com/@acmerobotics']);
  assert.deepEqual(p.socials.github, ['https://github.com/acme']);
  assert.deepEqual(p.socials.whatsapp, ['https://wa.me/972501234567']);
});

test('extracts company details, preferring structured data', () => {
  const c = extractPage(HOME, 'https://acme.test/').company;
  assert.equal(c.name, 'Acme Robotics Ltd.');
  assert.equal(c.description, 'Industrial robots for small factories.');
  assert.equal(c.logo, 'https://acme.test/logo.svg');
  assert.equal(c.favicon, 'https://acme.test/apple-touch-icon.png');
  assert.equal(c.image, 'https://acme.test/img/banner.jpg');
  assert.equal(c.language, 'en-US');
  assert.equal(c.address, '1 Main St, 3100001 Haifa, IL');
});

test('falls back to the page title for the company name', () => {
  assert.equal(nameFromTitle('Home | Acme Robotics'), 'Acme Robotics');
  assert.equal(nameFromTitle('Globex – Industrial Solutions for Everyone'), 'Globex');
  assert.equal(nameFromTitle('Welcome'), null);
  const c = extractPage('<html><head><title>Initech - Software that works</title></head><body></body></html>', 'https://initech.test/').company;
  assert.equal(c.name, 'Initech');
  assert.equal(c.favicon, 'https://initech.test/favicon.ico');
  const katz = extractPage('<html><head><title>Katz\'s Delicatessen | Since 1888</title></head></html>', 'https://katzsdelicatessen.test/').company;
  assert.equal(katz.name, "Katz's Delicatessen");
  const de = extractPage('<html><head><meta property="og:site_name" content="Günstige Server aus Deutschland"><title>Hetzner Online GmbH - Server</title></head></html>', 'https://www.hetzner.test/').company;
  assert.equal(de.name, 'Hetzner Online GmbH');
});

test('picks same-site contact/about pages, not blog posts or other sites', () => {
  const p = extractPage(HOME, 'https://acme.test/');
  const picked = pickContactPages(p.links, 'https://acme.test/', 3);
  assert.deepEqual(picked, ['https://acme.test/contact-us', 'https://acme.test/about']);
  assert.deepEqual(pickContactPages(p.links, 'https://acme.test/', 0), []);
});

test('merging puts the company-domain emails first and dedupes', () => {
  const m = mergePages(
    [
      { emails: ['someone@gmail.com', 'info@acme.test'], phones: ['+1555'], socials: { twitter: ['https://x.com/a'] } },
      { emails: ['info@acme.test', 'sales@eu.acme.test', 'jane@acme.test'], phones: ['+1555', '+44'], socials: { twitter: ['https://x.com/a'], github: ['https://github.com/a'] } },
    ],
    'https://www.acme.test/',
  );
  assert.deepEqual(m.emails, ['info@acme.test', 'sales@eu.acme.test', 'jane@acme.test', 'someone@gmail.com']);
  assert.deepEqual(m.phones, ['+1555', '+44']);
  assert.deepEqual(m.socials, { twitter: ['https://x.com/a'], github: ['https://github.com/a'] });
});

test('helpers', () => {
  assert.equal(cleanEmail('mailto:John.Doe%40Acme.test'), 'john.doe@acme.test');
  assert.equal(cleanEmail('icon@2x.webp'), null);
  assert.equal(decodeCfEmail(cf('a@b.co')), 'a@b.co');
  assert.equal(normalizePhone('tel:0049 30 1234567'), '+49301234567');
  assert.equal(normalizePhone('tel:123'), null);
  assert.equal(normalizePhone('tel:0000000000'), null);
  assert.equal(classifySocial('https://www.linkedin.com/in/jane-doe?trk=x').url, 'https://www.linkedin.com/in/jane-doe');
  assert.equal(classifySocial('https://x.com/home'), null);
  assert.equal(classifySocial('https://discord.com/invite/abc123').url, 'https://discord.gg/abc123');
  assert.equal(classifySocial('https://api.whatsapp.com/send?phone=+972501234567').url, 'https://wa.me/972501234567');
  assert.equal(classifySocial('https://www.tiktok.com/@acme?lang=en').url, 'https://www.tiktok.com/@acme');
});
