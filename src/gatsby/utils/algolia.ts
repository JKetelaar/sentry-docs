/* eslint-env node */
/* eslint import/no-nodejs-modules:0 */

import {promises as fs} from 'fs';
import {join, resolve} from 'path';

import {
  extrapolate,
  htmlToAlgoliaRecord,
  sentryAlgoliaIndexSettings,
  standardSDKSlug,
} from '@sentry-internal/global-search';

const pageQuery = `{
    pages: allSitePage {
      nodes {
        id
        path
        context {
          draft
          title
          noindex
          keywords
          platform {
            name
          }
          guide {
            name
          }
        }
      }
    }
  }`;

const pub = resolve(process.cwd(), 'public');

const flatten = async (pages: any[]) => {
  const records = (
    await Promise.all(
      pages
        .filter(
          ({context}) => context && !context.draft && !context.noindex && context.title
        )
        .map(async page => {
          // It's prohibitively difficult to query fully rendered html out of MDX even though it's the
          // preferred output format, due to performance and configuration problems.
          // Instead, we're pulling in the generated pages and parsing out the sections we care about.
          // This runs the risk of dirtier records but is much quicker and easier to work with.

          const {context, path} = page;
          const htmlFile = join(pub, path, 'index.html');
          const html = (await fs.readFile(htmlFile)).toString();

          // `platforms` deprecated in @sentry-global-search: 0.5.9
          // we keep it in algolia records for backwards compatibility
          let platforms: string[] = [];

          // https://github.com/getsentry/sentry-global-search#algolia-record-stategy
          let slug: string;
          let guideSlug: string;
          if (context.platform) {
            slug = standardSDKSlug(context.platform.name)?.slug;
            let fullSlug = slug;
            guideSlug = slug;

            if (context.guide) {
              guideSlug = standardSDKSlug(context.guide.name)?.slug;
              fullSlug += `.${guideSlug}`;
            }

            platforms = extrapolate(fullSlug ?? 'generic', '.');
          }

          const newRecords = htmlToAlgoliaRecord(
            html,
            {
              title: context.title,
              url: path,
              sdk: slug,
              framework: guideSlug,
              platforms,
              pathSegments: extrapolate(path, '/').map(x => `/${x}/`),
              keywords: context.keywords || [],
              legacy: context.legacy || false,
            },
            '#main'
          );

          return newRecords;
        })
    )
  ).reduce((a, x) => {
    return [...a, ...x];
  }, []);

  return records;
};

const indexPrefix = process.env.GATSBY_ALGOLIA_INDEX_PREFIX;
if (!indexPrefix) {
  throw new Error('`GATSBY_ALGOLIA_INDEX_PREFIX` must be configured!');
}

const config = [
  {
    query: pageQuery,
    transformer: ({data}) => flatten(data.pages.nodes),
    indexName: `${indexPrefix}docs-v2`,
    settings: {
      ...sentryAlgoliaIndexSettings,
    },
  },
];

export default config;
