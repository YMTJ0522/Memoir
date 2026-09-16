use crate::domain::{AppError, AppResult, ErrorCode};
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::blocking::Client;
use std::time::Duration;

const REQUEST_TIMEOUT_SECS: u64 = 10;
const CONNECT_TIMEOUT_SECS: u64 = 5;
const MAX_HTML_BYTES: usize = 512 * 1024;
const MAX_RESULTS: usize = 8;

#[derive(Debug, Clone)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

pub fn web_search(query: &str) -> AppResult<Vec<SearchResult>> {
    let encoded = utf8_percent_encode(query, NON_ALPHANUMERIC).to_string();
    let search_url = format!("https://lite.duckduckgo.com/lite/?q={}", encoded);

    let client = Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent(format!(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Memoir/{}",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(map_reqwest)?;

    let response = client
        .get(&search_url)
        .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
        .send()
        .map_err(map_reqwest)?;

    let status = response.status();
    if !status.is_success() {
        return Err(
            AppError::new(ErrorCode::Io, "Web search failed.")
                .with_details(format!("HTTP {}", status.as_u16())),
        );
    }

    let bytes = response.bytes().map_err(map_reqwest)?;
    let sliced = if bytes.len() > MAX_HTML_BYTES {
        &bytes[..MAX_HTML_BYTES]
    } else {
        &bytes
    };
    let html = String::from_utf8_lossy(sliced).into_owned();

    Ok(parse_duckduckgo_lite(&html))
}

fn parse_duckduckgo_lite(html: &str) -> Vec<SearchResult> {
    let mut results = Vec::new();
    let mut pos = 0;

    while results.len() < MAX_RESULTS {
        // DuckDuckGo lite: result links are in <a class="result-link" href="...">Title</a>
        let link_start = match html[pos..].find("result-link") {
            Some(idx) => pos + idx,
            None => break,
        };

        // Find href
        let href_start = match html[link_start..].find("href=\"") {
            Some(idx) => link_start + idx + 6,
            None => {
                pos = link_start + 1;
                continue;
            }
        };
        let href_end = match html[href_start..].find('"') {
            Some(idx) => href_start + idx,
            None => {
                pos = href_start + 1;
                continue;
            }
        };
        let url = html[href_start..href_end].to_string();

        // Find title (between > and </a>)
        let title_start = match html[href_end..].find('>') {
            Some(idx) => href_end + idx + 1,
            None => {
                pos = href_end + 1;
                continue;
            }
        };
        let title_end = match html[title_start..].find("</a>") {
            Some(idx) => title_start + idx,
            None => {
                pos = title_start + 1;
                continue;
            }
        };
        let title = strip_html_tags(&html[title_start..title_end]);

        // Find snippet (next <td class="result-snippet">)
        let snippet_start = match html[title_end..].find("result-snippet") {
            Some(idx) => {
                let s = title_end + idx;
                match html[s..].find('>') {
                    Some(i) => s + i + 1,
                    None => {
                        pos = title_end + 1;
                        continue;
                    }
                }
            }
            None => {
                results.push(SearchResult {
                    title,
                    url,
                    snippet: String::new(),
                });
                pos = title_end + 1;
                continue;
            }
        };
        let snippet_end = match html[snippet_start..].find("</td>") {
            Some(idx) => snippet_start + idx,
            None => {
                results.push(SearchResult {
                    title,
                    url,
                    snippet: String::new(),
                });
                pos = snippet_start + 1;
                continue;
            }
        };
        let snippet = strip_html_tags(&html[snippet_start..snippet_end]);

        results.push(SearchResult {
            title,
            url,
            snippet,
        });
        pos = snippet_end + 1;
    }

    results
}

fn strip_html_tags(input: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result.trim().to_string()
}

fn map_reqwest(error: reqwest::Error) -> AppError {
    let message = if error.is_timeout() {
        "Web search timed out."
    } else if error.is_connect() {
        "Couldn't reach the search engine."
    } else {
        "Web search failed."
    };
    AppError::new(ErrorCode::Io, message).with_details(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_html_tags() {
        assert_eq!(strip_html_tags("<b>Hello</b> World"), "Hello World");
        assert_eq!(strip_html_tags("Plain text"), "Plain text");
    }
}
