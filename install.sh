#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="opencode-autotitle"
PLUGIN_DIR="$HOME/.config/opencode/plugins/$PLUGIN_NAME"
REPO_URL="https://github.com/pawelma/opencode-autotitle"
RAW_URL="https://raw.githubusercontent.com/pawelma/opencode-autotitle/main"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_banner() {
    echo -e "${BLUE}"
    echo "  ╔═══════════════════════════════════════╗"
    echo "  ║       opencode-autotitle              ║"
    echo "  ║  AI-powered session naming for        ║"
    echo "  ║           OpenCode                    ║"
    echo "  ╚═══════════════════════════════════════╝"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}→${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}!${NC} $1"
}

check_opencode() {
    if ! command -v opencode &> /dev/null; then
        print_error "OpenCode is not installed"
        echo ""
        echo "Install OpenCode first:"
        echo "  curl -fsSL https://opencode.ai/install | bash"
        echo ""
        echo "Or visit: https://opencode.ai/docs"
        exit 1
    fi
    
    local version=$(opencode --version 2>/dev/null || echo "unknown")
    print_success "OpenCode found (version: $version)"
}

install_plugin() {
    print_info "Installing $PLUGIN_NAME..."
    
    mkdir -p "$HOME/.config/opencode/plugins"
    
    if [ -d "$PLUGIN_DIR" ]; then
        print_info "Updating existing installation..."
        cd "$PLUGIN_DIR"
        if [ -d ".git" ]; then
            git pull --quiet
        else
            cd ..
            rm -rf "$PLUGIN_DIR"
            git clone --quiet "$REPO_URL" "$PLUGIN_DIR"
        fi
    else
        git clone --quiet "$REPO_URL" "$PLUGIN_DIR"
    fi
    
    print_success "Plugin cloned to $PLUGIN_DIR"
}

build_plugin() {
    print_info "Building plugin..."
    
    cd "$PLUGIN_DIR"
    
    if command -v bun &> /dev/null; then
        bun install --silent
        bun run build
        print_success "Built with Bun"
    elif command -v npm &> /dev/null; then
        npm install --silent
        npm run build
        print_success "Built with npm"
    else
        print_warning "Neither Bun nor npm found"
        print_info "The plugin will be built automatically by OpenCode on first run"
    fi
}

add_to_config() {
    local config_file="$HOME/.config/opencode/opencode.json"
    
    print_info "Adding plugin to OpenCode config..."
    
    # Create config directory if it doesn't exist
    mkdir -p "$HOME/.config/opencode"
    
    # If config file doesn't exist, create it with the plugin
    if [ ! -f "$config_file" ]; then
        cat > "$config_file" << 'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-autotitle"]
}
EOF
        print_success "Created $config_file with plugin"
        return
    fi
    
    # Check if plugin is already in config
    if grep -q "opencode-autotitle" "$config_file" 2>/dev/null; then
        print_success "Plugin already in config"
        return
    fi
    
    # Try to add plugin to existing config using different methods
    if command -v jq &> /dev/null; then
        # Use jq if available (most reliable)
        local tmp_file=$(mktemp)
        if jq '.plugin = (.plugin // []) + ["opencode-autotitle"] | .plugin |= unique' "$config_file" > "$tmp_file" 2>/dev/null; then
            mv "$tmp_file" "$config_file"
            print_success "Added plugin to config using jq"
            return
        fi
        rm -f "$tmp_file"
    fi
    
    # Fallback: Try to add using sed for simple cases
    # Case 1: "plugin": [] - empty array
    if grep -q '"plugin"[[:space:]]*:[[:space:]]*\[\]' "$config_file"; then
        sed -i.bak 's/"plugin"[[:space:]]*:[[:space:]]*\[\]/"plugin": ["opencode-autotitle"]/' "$config_file"
        rm -f "${config_file}.bak"
        print_success "Added plugin to empty plugin array"
        return
    fi
    
    # Case 2: "plugin": ["something"] - existing array
    if grep -q '"plugin"[[:space:]]*:[[:space:]]*\[' "$config_file"; then
        # Add to existing array (before the closing bracket)
        sed -i.bak 's/"plugin"[[:space:]]*:[[:space:]]*\[/"plugin": ["opencode-autotitle", /' "$config_file"
        rm -f "${config_file}.bak"
        print_success "Added plugin to existing plugin array"
        return
    fi
    
    # Case 3: No plugin key exists - need to add it
    # This is trickier without jq, so we'll warn the user
    print_warning "Could not automatically add plugin to config"
    echo ""
    echo "Please manually add to $config_file:"
    echo '  "plugin": ["opencode-autotitle"]'
    echo ""
}

print_next_steps() {
    echo ""
    echo -e "${GREEN}Installation complete!${NC}"
    echo ""
    echo "Your sessions will now be automatically titled based on context."
    echo "  🔍 = Quick keyword title (appears immediately)"
    echo "  ✨ = AI-generated title (appears after AI responds)"
    echo ""
    echo -e "${BLUE}Configuration (optional):${NC}"
    echo "  Set environment variables to customize behavior:"
    echo ""
    echo "  OPENCODE_AUTOTITLE_MODEL=anthropic/claude-haiku-4-5"
    echo "  OPENCODE_AUTOTITLE_MAX_LENGTH=60"
    echo "  OPENCODE_AUTOTITLE_DEBUG=1"
    echo ""
    echo -e "${BLUE}Usage:${NC}"
    echo "  Just use OpenCode normally - titles are generated automatically."
    echo ""
    echo -e "${BLUE}Documentation:${NC}"
    echo "  https://github.com/pawelma/opencode-autotitle"
    echo ""
}

main() {
    print_banner
    
    check_opencode
    install_plugin
    build_plugin
    add_to_config
    print_next_steps
}

main "$@"
