#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="opencode-autotitle"
PLUGINS_DIR="$HOME/.config/opencode/plugins"
PLUGIN_FILE="$PLUGINS_DIR/$PLUGIN_NAME.js"
REPO_URL="https://github.com/pawelma/opencode-autotitle"
RAW_URL="https://raw.githubusercontent.com/pawelma/opencode-autotitle/refs/heads/master"

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
    
    # Create plugins directory
    mkdir -p "$PLUGINS_DIR"
    
    # Create temp directory for cloning and building
    local tmp_dir=$(mktemp -d)
    trap "rm -rf $tmp_dir" EXIT
    
    print_info "Cloning repository..."
    git clone --quiet --depth 1 "$REPO_URL" "$tmp_dir"
    
    print_info "Building plugin..."
    cd "$tmp_dir"
    
    if command -v bun &> /dev/null; then
        bun install --silent
        bun run build
        print_success "Built with Bun"
    elif command -v npm &> /dev/null; then
        npm install --silent
        npm run build
        print_success "Built with npm"
    else
        print_error "Neither Bun nor npm found - cannot build plugin"
        exit 1
    fi
    
    # Copy built plugin to plugins directory
    if [ -f "$tmp_dir/dist/index.js" ]; then
        cp "$tmp_dir/dist/index.js" "$PLUGIN_FILE"
        print_success "Plugin installed to $PLUGIN_FILE"
    else
        print_error "Build failed - dist/index.js not found"
        exit 1
    fi
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
    echo "  OPENCODE_AUTOTITLE_DEBUG=debug.log"
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
    print_next_steps
}

main "$@"
