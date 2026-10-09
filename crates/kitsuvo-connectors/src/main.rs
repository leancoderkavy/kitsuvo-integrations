fn main() {
    if let Err(error) = kitsuvo_connectors::run(&std::env::args().skip(1).collect::<Vec<_>>()) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
