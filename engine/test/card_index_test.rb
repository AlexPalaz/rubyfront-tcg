# frozen_string_literal: true

require "json"
require "minitest/autorun"
require_relative "../lib/rubyfront/card_index"

# L'anagrafe letta dai dati veri del repo: se questi test si rompono, o è
# cambiato lo schema delle carte o è cambiato il posto dei dati.
class CardIndexTest < Minitest::Test
  DATA_DIR = File.expand_path("../../data", __dir__)

  def setup
    @index = Rubyfront::CardIndex.load(DATA_DIR)
  end

  # Il debito dichiarato della regola d'oro (§1.1): i trigger delle carte
  # che NESSUNA forma certificata legge ancora. Ogni carta collegata toglie
  # la sua voce; un trigger che sparisce da qui senza una forma nuova, o che
  # vi compare, è una forma rotta o un dato cambiato di nascosto — e il test
  # lo dice forte, prima che l'effetto svanisca in silenzio dal tavolo.
  DEBITO = [
    "RBF-023 rubyfront/schism-forge",
    "RBF-023 nexus/awakening",
    "RBF-023 nexus/deep-forge-sight",
    "RBF-024 entity/grip",
    "RBF-025 entity/tally",
    "RBF-028 entity/temper",
    "RBF-030 entity/outfit",
    "RBF-030 entity/carry",
    "RBF-031 entity/aura",
    "RBF-032 object/edge",
    "RBF-033 object/brace",
    "RBF-033 object/spikes",
    "RBF-035 object/relic",
    "RBF-035 object/remain",
    "RBF-036 matter/amplify",
    "RBF-037 matter/veil",
    "RBF-038 matter/evert",
    "RBF-039 matter/refract",
    "RBF-040 matter/reflect",
    "RBF-041 matter/surge-search",
    "RBF-042 matter/assault",
    "RBF-043 object/confine",
    "RBF-044 matter/sunder",
  ].freeze

  def test_ogni_trigger_ha_una_forma_o_sta_nel_debito_dichiarato
    ignoti = Rubyfront::CardIndex.unknown_triggers(DATA_DIR)
    rotti = ignoti - DEBITO
    assert_empty rotti, "trigger che nessuna forma legge più (forma rotta o dato cambiato): #{rotti.join(", ")}"
    saldati = DEBITO - ignoti
    assert_empty saldati, "trigger ormai riconosciuti: toglierli dal DEBITO: #{saldati.join(", ")}"
  end

  def test_i_trigger_certificati_sono_riconosciuti
    scout = JSON.parse(File.read(File.join(DATA_DIR, "sets", "srbf-001", "cards", "rbf-026", "rbf-026.json")))
    trigger = scout["faces"].flat_map { |face| face["triggers"] }.find { |t| t["id"] == "scouting" }
    assert Rubyfront::CardIndex.recognized?(trigger)
    # Lo stesso trigger con lo scarto a 2 esce dalla forma: ignoto, non frainteso.
    altro = Marshal.load(Marshal.dump(trigger))
    altro["effect"]["details"]["thenDiscardCards"] = 2
    refute Rubyfront::CardIndex.recognized?(altro)
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
    forma = [{ from: "ritiro", filter: { type: "matter", behavior: "permanent" }, to: "field" }]
    assert_equal forma, @index["RBF-012"][:enter_returns]
    assert_equal forma, @index["RBF-012"][:attack_returns], "e anche quando attacca"
    assert_equal [], @index["RBF-012"][:attack_draws], "Rhen riporta, non pesca"
  end

  def test_le_forme_quando_attacca_delle_carte_vere
    forme = ->(id) { @index[id][:attack_forms].map { |form| [form[:kind], form[:who], form[:face]] } }
    assert_equal [["untap", "self", 0]], forme.call("RBF-028")
    assert_equal [["empower", "self", 0]], forme.call("RBF-029")
    assert_equal [["empower", "object", 0], ["look", "object", 0]], forme.call("RBF-034")
    assert_equal [["rearm", "ally", 0], ["look", "ally", 0]], forme.call("RBF-031")
    assert_equal [["heal", "self", 0]], forme.call("RBF-008")
    assert_equal [["return", "self", 0]], forme.call("RBF-010")
    assert_equal [["refresh", "self", 0]], forme.call("RBF-011")
    assert_equal [["heal", "permanent", 0]], forme.call("RBF-022")
    assert_equal [["heal", "rubyfront", 0], ["heal", "rubyfront", 1]], forme.call("RBF-001")
    assert_equal [["empower", "self", 0]], forme.call("RBF-004")
    assert_equal [["empower", "self", 0]], forme.call("RBF-005")
    # I dettagli che contano: dadi, soglie, destinazioni, seguiti.
    assert_equal({ die: 6, on_roll: [5, 6], count: 4, reveal_to: "hand", rest_to: "ritiro" }, @index["RBF-034"][:attack_forms][1].slice(:die, :on_roll, :count, :reveal_to, :rest_to))
    assert_equal({ once: true, count: 2, reveal_to: "ritiro", rest_to: "deck" }, @index["RBF-031"][:attack_forms][1].slice(:once, :count, :reveal_to, :rest_to))
    assert_equal({ amount: 2, die: 6, on_roll: [5, 6] }, @index["RBF-008"][:attack_forms][0].slice(:amount, :die, :on_roll))
    assert_equal({ die: 20, on_roll: [15, 20] }, @index["RBF-011"][:attack_forms][0].slice(:die, :on_roll))
    assert_equal({ gain_on: [1, 6], drain_on: [15, 20] }, @index["RBF-022"][:attack_forms][0].slice(:gain_on, :drain_on))
    assert_equal [0, 1], @index["RBF-001"][:attack_forms].map { |form| form[:then_draw] }, "solo il Nexus pesca"
    assert_equal({ targets: "next_human_attacker", grants: ["revenge"] }, @index["RBF-004"][:attack_forms][0].slice(:targets, :grants))
    assert_equal({ count: 2, race: "human" }, @index["RBF-005"][:attack_forms][0][:requires_previous_attackers])
  end

  # --- gli statici, le Materie e il flip di Eredità Perduta (§8.2, §7.2, §3.1) --

  def test_gli_statici_di_potenza_delle_carte_vere
    assert_equal [{ kind: "self_power", amount: 1, while_attacking: true, requires_other: { type: "entity", race: "human" } }], @index["RBF-002"][:static_forms]
    assert_equal [{ kind: "self_power", amount: 1, per_other: { type: "entity", race: "human" } }], @index["RBF-010"][:static_forms]
    assert_equal [{ kind: "bearer_power", amount: 1 }], @index["RBF-013"][:static_forms], "il +1 del Vigorscudo; la Stasi sta nelle concessioni"
    assert_equal [{ kind: "bearer_power", amount: 1, per: { type: "entity", race: "human" }, multi_block: true }], @index["RBF-014"][:static_forms]
    assert_equal [], @index["RBF-028"][:static_forms], "«Contrattacco +2 se armata» non è una forma certificata"
    assert_equal [], @index["RBF-031"][:static_forms], "«+1 alle altre armate» resta nel debito"
  end

  def test_le_materie_di_eredita_perduta_alla_risoluzione
    forme = ->(id) { @index[id][:resolve_forms] }
    assert_equal [{ kind: "look", count: 4, reveal: { type: "entity", race: "human" }, reveal_to: "hand", rest_to: "deck", show_up_to: 2 }], forme.call("RBF-015")
    assert_equal [{ kind: "empower", targets: "own_entity", race: "human", power: 1, untap: true }], forme.call("RBF-016")
    assert_equal [{ kind: "move", target: { type: "entity", controller: "opponent", max_cost: 2 }, to: "ritiro" }], forme.call("RBF-017")
    assert_equal [{ kind: "exile", target: { permanent: true, controller: "opponent" }, to: "abisso", hold: true }], forme.call("RBF-018")
    assert_equal [{ kind: "fortune", die: 20, gain: { on: [1, 6], amount: 4 }, deploy: { on: [7, 13], filter: { type: "entity", race: "human", max_cost: 2 } },
                    draw: { on: [14, 19], count: 1 }, all_on: [20, 20] }], forme.call("RBF-019")
    assert_equal [{ kind: "empower", targets: "own_entities", race: "human", counter: 1, untap: true, as_block: true, requires: { count: 3, race: "human" } }], forme.call("RBF-020")
    assert_equal [{ kind: "destroy", target: { type: "entity", controller: "any" }, to: "abisso", discount: { amount: 3, if_target: "tapped" } }], forme.call("RBF-021")
    assert_equal [], forme.call("RBF-038"), "«poi perdi 2 PV» è un seguito ignoto: la forma non entra"
    assert_equal [], forme.call("RBF-022"), "la permanente degli Eredi si innesca all'attacco, non alla risoluzione"
  end

  def test_il_nexus_di_oblivhal_e_il_suo_flip
    assert_equal({ face: 1, conditions: [{ count: 4, type: "entity", race: "human" }], discard: { count: 1, type: "entity" }, recovery: 5 }, @index["RBF-001"][:nexus])
    assert_equal [{ kind: "move", card_id: "RBF-012", from: "field", to: "abisso" }, { kind: "seal", card_id: "RBF-012" }], @index["RBF-001"][:flip_forms]
    assert_nil @index["RBF-023"][:nexus], "«con un Oggetto assegnato» e il costo dal Ritiro sono forme ignote: il flip di Rhazmora resta a mano"
    assert_equal %w[move seal], @index["RBF-023"][:flip_forms].map { |form| form[:kind] }, "ma i suoi «quando flippa» hanno la stessa forma"
    assert_nil @index["RBF-004"][:nexus]
  end

  def test_l_esploratore_pesca_quando_attacca_armato
    assert_equal [{ draw: 1, then_discard: 1, requires_object: true }], @index["RBF-026"][:attack_draws]
    assert_equal [], @index["RBF-003"][:attack_draws], "la Guida ascolta gli ingressi, non attacca"
    assert_equal [], @index["RBF-007"][:enter_returns]
    assert_equal [], @index["RBF-007"][:attack_returns]
  end

  def test_il_cercatore_guarda_quattro_carte
    assert_equal [{ count: 4, die: nil, count_base: 0, reveal: { type: "entity", race: "human" }, then_retire: false }], @index["RBF-006"][:enter_looks]
  end

  def test_l_artefice_tira_un_d6_e_ne_manda_una_in_ritiro
    assert_equal [{ count: nil, die: 6, count_base: 2, reveal: { type: "object", race: nil }, then_retire: true }], @index["RBF-027"][:enter_looks]
  end

  def test_il_radunatore_prende_il_controllo_fino_a_fine_turno
    assert_equal [{ target: { type: "entity", controller: "opponent", max_cost: 3 }, grants: ["surge"] }], @index["RBF-009"][:enter_controls]
    assert_equal [], @index["RBF-007"][:enter_controls]
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
