/*
 * Copyright (c) 2026, AArel OS developers
 *
 * SPDX-License-Identifier: BSD-2-Clause
 */

#pragma once

#include <AK/String.h>
#include <AK/StringView.h>

namespace LLeraService {

struct PolicyDecision {
    bool accepted { false };
    String reason;
};

class Policy {
public:
    static PolicyDecision evaluate(StringView capability, StringView verb, StringView argument);

private:
    static bool is_safe_web_url(StringView);
};

}
