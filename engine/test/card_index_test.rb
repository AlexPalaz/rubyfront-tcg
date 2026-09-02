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

  # --- gli ascoltatori d'ingresso certificati (§8.2) ----------------------

  def test_la_guida_ascolta_gli_ingressi_degli_umani
    listeners = @index["RBF-003"][:enter_listeners]
    assert_equal 1, listeners.size
    assert_equal({ entering_race: "human", requires: { count: 3, race: "human" }, draw: 1 }, listeners.first)
    assert_equal [], @index["RBF-004"][:enter_listeners], "un on_attack non è un ascoltatore d'ingresso"
    assert_equal [], @index["RBF-007"][:enter_listeners], "un move_card all'ingresso non è la forma certificata"
  end

  def test_l_arciere_manda_un_entita_avversaria_in_ritiro
    assert_equal [{ target: { type: "entity", controller: "opponent" }, to: "ritiro" }], @index["RBF-007"][:enter_moves]
    assert_equal [], @index["RBF-003"][:enter_moves], "un ascoltatore non è uno spostamento di chi entra"
    assert_equal [], @index["RBF-012"][:enter_moves], "dalla propria Zona di Ritiro al Fronte è un'altra forma"
  end

  def test_rhen_riporta_una_permanente_dalla_zona_di_ritiro
    assert_equal [{ from: "ritiro", filter: { type: "matter", behavior: "permanent" }, to: "field" }], @index["RBF-012"][:enter_returns]
    assert_equal [], @index["RBF-007"][:enter_returns]
  end

  # --- il costo di schieramento (§3.1) ------------------------------------

  def test_conosce_il_costo_di_schieramento_fisso_o_a_dado
    assert_equal({ fixed: 3, die: nil }, @index["RBF-023"][:deployment])
    assert_equal({ fixed: nil, die: 6 }, @index["RBF-001"][:deployment])
    assert_nil @index["RBF-004"][:deployment], "un'Entità non si schiera"
    assert_equal({ fixed: 2, die: nil }, Rubyfront::CardIndex.deployment_of(2))
    assert_nil Rubyfront::CardIndex.deployment_of({ "die" => "dado" })
  end

  # --- Materie e abilitazioni (§7) ----------------------------------------

  def test_conosce_tipo_e_grado_delle_materie
    assert_equal({ type: "dimensional", grade: 1 }, @index["RBF-040"][:matter])
    assert_nil @index["RBF-004"][:matter], "un'Entità non è una Materia"
  end

  def test_conosce_le_abilitazioni_per_faccia
    assert_equal [[{ type: "dynamic", max_grade: 1 }]], @index["RBF-004"][:enables]
    rubino = @index["RBF-023"][:enables]
    assert_equal 2, rubino.size, "Rubyfront e Nexus: una lista per faccia"
    assert_includes rubino[0], { type: "destructive", max_grade: 1 }
    assert_includes rubino[1], { type: "destructive", max_grade: 2 }, "il Nexus abilita di più (§3.1)"
    assert_equal [[]], @index["RBF-040"][:enables], "una Materia non abilita nulla"
  end

  # --- il costo di Flusso (§3.2) ------------------------------------------

  def test_conosce_il_costo_di_flusso
    assert_equal 2, @index["RBF-004"][:flux_cost]
    assert_equal 2, @index["RBF-040"][:flux_cost], "anche le Materie si pagano"
    assert_nil @index["RBF-023"][:flux_cost], "il Rubyfront ha il costo di schieramento, non di Flusso"
  end

  # --- il comportamento delle Materie (§7.2) ------------------------------

  def test_conosce_le_materie_reattive
    assert_equal "reactive", @index["RBF-040"][:behavior]
    assert_nil @index["RBF-004"][:behavior], "un'Entità non ha comportamento di Materia"
  end

  # --- le statistiche del combattimento (§6.3) ----------------------------

  def test_conosce_la_potenza_delle_entita
    assert_equal 2, @index["RBF-004"][:power]
    assert_equal 3, @index["RBF-028"][:power]
  end

  def test_conosce_il_contrattacco_solo_di_chi_ce_l_ha
    assert_equal 1, @index["RBF-028"][:counterattack]
    assert_nil @index["RBF-004"][:counterattack], "senza la statistica non si contrattacca"
  end

  def test_chi_non_e_entita_non_ha_potenza
    assert_nil @index["RBF-013"][:power], "un Oggetto non ha Potenza"
    assert_nil @index["RBF-023"][:power], "il Rubyfront non ha Potenza: non attacca (§3.1)"
  end

  def test_un_valore_non_intero_resta_ignoto
    assert_nil Rubyfront::CardIndex.integer_stat({ "base" => 3 })
    assert_nil Rubyfront::CardIndex.integer_stat("3")
    assert_equal 3, Rubyfront::CardIndex.integer_stat(3)
  end

  # --- razza e concessioni certificate -----------------------------------

  def test_conosce_la_razza_delle_entita
    assert_equal "human", @index["RBF-009"][:race]
    assert_nil @index["RBF-013"][:race], "un Oggetto non ha razza"
  end

  def test_il_vigorscudo_concede_stasi_agli_umani
    grants = @index["RBF-013"][:grants_while_assigned]
    assert_equal 1, grants.size, "RBF-013 ha una sola concessione certificata"
    assert_equal ["stasis"], grants.first[:keywords]
    assert_equal "human", grants.first[:if_race]
  end

  def test_solo_la_forma_certificata_entra_nell_anagrafe
    # RBF-013 ha anche un secondo trigger while_assigned (+1 Potenza,
    # modify_power): non è la forma certificata e non deve comparire.
    grants = @index["RBF-013"][:grants_while_assigned]
    assert grants.all? { |grant| grant[:keywords].any? }, "solo empower con grants"
    # E chi non concede nulla ha la lista vuota, mai nil.
    assert_equal [], @index["RBF-009"][:grants_while_assigned]
  end
end
