/*
 * Copyright (c) 2026, AArel OS developers
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#include "Policy.h"
#include <AK/Literals.h>

using namespace AK::Literals;

namespace LLeraService {

bool Policy::is_safe_web_url(StringView url)
{
    if (url.length() == 0 || url.length() > 4096)
        return false;

    if (!(url.starts_with("https://"sv) || url.starts_with("http://"sv)))
        return false;

    // Reject URL forms that are commonly abused to smuggle credentials or
    // parser-confusing whitespace through a privileged broker.
    if (url.contains('@') || url.contains(' ') || url.contains('\t') || url.contains('\n') || url.contains('\r'))
        return false;

    return true;
}

PolicyDecision Policy::evaluate(StringView capability, StringView verb, StringView argument)
{
    if (capability == "app.open"sv) {
        if (!argument.is_empty())
            return { false, "unexpected-app-argument"sv };

        if (verb == "terminal"sv || verb == "browser"sv || verb == "files"sv || verb == "settings"sv)
            return { true, "accepted-for-forge-broker"sv };

        return { false, "unsupported-app"sv };
    }

    if (capability == "web.open"sv) {
        if (verb != "url"sv)
            return { false, "unsupported-web-verb"sv };

        if (!is_safe_web_url(argument))
            return { false, "invalid-web-url"sv };

        return { true, "accepted-for-browser-broker"sv };
    }

    return { false, "denied-by-policy"sv };
}

}
