// Eleventy configuration.
//
// The site is a hybrid: the homepage and the /ai and /kirkle apps are
// hand-authored static files that Eleventy copies through verbatim, while the
// blog (Markdown under /blog) is templated with the Nunjucks layouts in
// _includes. Input is the repo root and output is _site, so the built folder is
// a complete copy of the site ready to deploy to GitHub Pages.

module.exports = function (eleventyConfig) {
    // Existing hand-authored assets — copied to _site untouched. These are also
    // listed in .eleventyignore so Eleventy never tries to template them.
    eleventyConfig.addPassthroughCopy("index.html");
    eleventyConfig.addPassthroughCopy("ai");
    eleventyConfig.addPassthroughCopy("kirkle");
    eleventyConfig.addPassthroughCopy("images");
    eleventyConfig.addPassthroughCopy("theme.css");
    eleventyConfig.addPassthroughCopy("theme.js");
    eleventyConfig.addPassthroughCopy("blog.css");
    eleventyConfig.addPassthroughCopy("favicon.svg");
    eleventyConfig.addPassthroughCopy("favicon-32.png");
    eleventyConfig.addPassthroughCopy("apple-touch-icon.png");

    // Custom domain marker — GitHub Pages needs this in the deployed output.
    eleventyConfig.addPassthroughCopy("CNAME");

    // Human-readable post dates, e.g. "September 2, 2026".
    eleventyConfig.addFilter("readableDate", function (value) {
        const date = value instanceof Date ? value : new Date(value);
        return date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
        });
    });

    // Machine-readable date for <time datetime="...">, e.g. "2026-09-02".
    eleventyConfig.addFilter("isoDate", function (value) {
        const date = value instanceof Date ? value : new Date(value);
        return date.toISOString().slice(0, 10);
    });

    // Full RFC-3339 timestamp for the Atom feed.
    eleventyConfig.addFilter("rfc3339", function (value) {
        const date = value instanceof Date ? value : new Date(value);
        return date.toISOString();
    });

    return {
        dir: {
            input: ".",
            output: "_site",
            includes: "_includes",
            data: "_data",
        },
        markdownTemplateEngine: "njk",
        htmlTemplateEngine: "njk",
        templateFormats: ["md", "njk", "html"],
    };
};
