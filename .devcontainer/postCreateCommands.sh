git clone https://github.com/jmmerida/dotfiles.git ~/dotfiles
cd ~/dotfiles
./setup.sh
export SHELL="zsh"
pipx install uv
cd /workspaces/MyInvestorACtualImporter/myInvestorActualImporter
uv sync