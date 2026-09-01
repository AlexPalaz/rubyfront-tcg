# frozen_string_literal: true

require "minitest/autorun"
require_relative "../lib/rubyfront/card_index"

# L'anagrafe letta dai dati veri del repo: se questi test si rompono, o è
# cambiato lo schema delle carte o è cambiato il posto dei dati.
class CardIndexTest < Minitest::Test
  DATA_DIR = File.expand_path("../../data", __dir__)

  def setup
    @index = Rubyfront::CardIndex.load(DATA_DIR)
  end

  def test_legge_il_set
    refute_empty @index, "nessuna carta trovata in #{DATA_DIR}"
  end

  def test_conosce_il_radunatore_con_slancio
    card = @index["RBF-009"]
    refute_nil card, "RBF-009 manca dall'anagrafe"
    assert_equal "entity", card[:type]
    assert_includes card[:keywords], "surge"
  end

  def test_ignora_i_file_di_testo_locale
    # I *.it.json e *.en.json non hanno "id" di carta o non rispettano il
    # nome della cartella: nessuna chiave dell'indice deve essere nil o vuota.
    assert @index.keys.all? { |id| id.is_a?(String) && !id.empty? }
  end

  def test_cartella_inesistente_da_indice_vuoto
    assert_empty Rubyfront::CardIndex.load("/posto/che/non/esiste")
  end
end
